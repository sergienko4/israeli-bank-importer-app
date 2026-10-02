/**
 * Fails the build when the release workflows stop agreeing with the app or with
 * each other.
 *
 * A release attaches two APKs and publishes two updates, and nothing ties the
 * names and channels in the workflows to the ones the app asks for except this
 * check. Each mismatch it looks for builds, uploads and publishes without an
 * error: the app just never finds its APK, or the SMS build never receives an
 * update, and nobody notices until a phone does. The same goes for the guards
 * the release workflows carry: a job that builds whatever the tag names instead
 * of the verified commit, a `gh` step without a token, or a pull-request check
 * that can reach a signing key all run green.
 *
 * Rules, each reported by name:
 *   1. names       - uploaded, downloaded and guarded asset names equal the
 *                    constants the app looks them up by;
 *   2. channel     - the OTA matrix publishes the SMS build's update to the
 *                    channel its config asks for, and the standard one to the
 *                    channel EAS Build gives the standard APK;
 *   3. provenance  - every workflow that takes a release tag builds only the
 *                    commit verify-release-tag.yml resolved it to;
 *   4. token       - every `gh` or EAS command receives only its own token,
 *                    and Expo setup cannot export EXPO_TOKEN job-wide;
 *   5. isolation   - the pull-request build check can reach no secret;
 *   6. orchestration - release-please calls the SMS build only after the
 *                      standard APK and both OTA legs succeed;
 *   7. asset safety - both APK uploaders serialize by tag and run the same
 *                     fail-closed standard-first guard after every upload,
 *                     and standard replacement withdraws SMS before clobber;
 *   8. update lookup - the SMS build uses the paginated update-group lookup.
 *   9. build hygiene - the local builder removes its generated native project
 *                      on success, failure and interruption.
 *  10. signature profile - the builder compares every APK signing scheme, not
 *                          only the signing certificate.
 *  11. secret boundary - EAS CLI finishes before signing material exists, and
 *                        the builder receives no Expo token.
 *
 * Usage:
 *   node scripts/check-release.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import {
  parseApkSignatureProfile,
  isMissingSigningLineageError,
  sameSigningSchemes,
  signingSchemeArguments,
} from './apk-signature-profile.mjs';
import { branchFromChannelView, findMatchingUpdate } from './find-matching-update.mjs';
import { prepareStandardApkReplacement, runCommandToFile } from './standard-apk-replacement.mjs';

/** The repository root, whatever directory the script is started from. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the workflows live, relative to the root. */
const WORKFLOWS = '.github/workflows';

/** Where the composite actions live, relative to the root. */
const ACTIONS = '.github/actions';

/** The source that names both APK assets for the app. */
const RELEASE_CHECK = 'src/lib/releaseCheck.ts';

/** The reusable workflow that resolves a release tag to a verified commit. */
const VERIFY = 'verify-release-tag.yml';

/** How a job calls {@link VERIFY}. */
const VERIFY_USES = `./${WORKFLOWS}/${VERIFY}`;

/** The workflow that attaches the standard APK. */
const STANDARD_WORKFLOW = 'release-apk.yml';

/** The workflow that attaches the SMS APK. */
const SMS_WORKFLOW = 'release-apk-sms.yml';

/** The shared action that protects older apps from the SMS APK. */
const APK_ORDER_ACTION = 'guard-apk-order';

/** The transactional helper that withdraws SMS before standard replacement. */
const STANDARD_REPLACEMENT = 'scripts/standard-apk-replacement.mjs';

/** The script that finds the matching EAS update across every result page. */
const UPDATE_LOOKUP = 'scripts/find-matching-update.mjs';

/** The local SMS APK builder that generates the Android project. */
const SMS_BUILD_SCRIPT = 'scripts/build-sms-apk.mjs';

/** The CLI that compares two real APK signing profiles. */
const APK_SIGNATURE_CHECK = 'scripts/compare-apk-signatures.mjs';

/** The shared parser and unsupported-lineage classifier. */
const APK_SIGNATURE_PROFILE = 'scripts/apk-signature-profile.mjs';

/** The workflow that publishes the updates. */
const OTA_WORKFLOW = 'release-ota.yml';

/** The workflow that creates a release and calls each publisher. */
const RELEASE_WORKFLOW = 'release-please.yml';

/** The pull-request build check, which must stay away from every secret. */
const PR_CHECK = 'sms-apk-check.yml';

/** The request header an Expo app names its update channel with. */
const CHANNEL_HEADER = 'expo-channel-name';

/** The EAS Build profile the standard APK is built with. */
const STANDARD_PROFILE = 'apk';

/** A `gh` command at the start of a shell word, which is how a step runs it. */
const GH_COMMAND = /(?:^|[\s;&|(`])gh\s+[a-z]/mu;

/** An EAS command at the start of a shell word, which is how a step runs it. */
const EAS_COMMAND = /(?:^|[\s;&|(`])eas\s+[a-z]/mu;

/** The setup action that exports a supplied token to every later job step. */
const EXPO_ACTION = 'expo/expo-github-action@';

/** The exact workflow expression that provides the Expo credential. */
const EXPO_TOKEN_SECRET = '${{ secrets.EXPO_TOKEN }}';

/** A file name ending in `.apk`, as it appears in a shell command. */
const APK_NAME = /(?<![\w.-])[\w-][\w.-]*\.apk(?![\w.-])/gu;

/** @type {string[]} */
const failures = [];

/**
 * Records a failure when a condition does not hold.
 *
 * @param {string} rule - The rule the condition belongs to.
 * @param {boolean} condition - What must be true.
 * @param {string} message - What is wrong when it is not.
 */
function check(rule, condition, message) {
  if (!condition) {
    failures.push(`[${rule}] ${message}`);
  }
}

/**
 * Normalizes line continuations while preserving shell command boundaries.
 *
 * @param {string} run - A workflow step's shell body.
 * @returns {string[]} Its non-empty logical lines.
 */
function logicalShellLines(run) {
  return run
    .replace(/\\\r?\n[ \t]*/gu, ' ')
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/[ \t]+/gu, ' '))
    .filter((line) => line !== '');
}

/**
 * Accepts only the narrow shell forms used by credentialed EAS steps.
 *
 * @param {string} run - A workflow step's shell body.
 * @returns {boolean} Whether exactly one trusted EAS entry point runs.
 */
function expoTokenRunIsNarrow(run) {
  if (
    run.includes('|') ||
    run.includes('&') ||
    run.includes('$(') ||
    run.includes('`') ||
    /[<>]\(/u.test(run) ||
    run.includes(';')
  ) {
    return false;
  }
  const lines = logicalShellLines(run);
  const commands = lines.filter(
    (line) => line.startsWith('eas ') || line === `node ${UPDATE_LOOKUP}`,
  );
  return (
    commands.length === 1 &&
    lines.every((line) => {
      if (line === 'umask 077' || line === "MESSAGE=${HEAD_MESSAGE%%$'\\n'*}") {
        return true;
      }
      if (line === `node ${UPDATE_LOOKUP}`) {
        return true;
      }
      if (!line.startsWith('eas ')) {
        return false;
      }
      return true;
    })
  );
}

/**
 * Reads a file under the root.
 *
 * @param {string} path - The path relative to the root.
 * @returns {string | undefined} Its text, or `undefined` when it does not exist.
 */
function readText(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : undefined;
}

/**
 * Parses every workflow.
 *
 * @returns {Map<string, { text: string, doc: any }>} Each workflow by file name.
 */
function loadWorkflows() {
  const workflows = new Map();
  for (const name of readdirSync(join(ROOT, WORKFLOWS)).sort()) {
    if (/\.ya?ml$/u.test(name)) {
      const text = readFileSync(join(ROOT, WORKFLOWS, name), 'utf8');
      workflows.set(name, { text, doc: parse(text) });
    }
  }
  return workflows;
}

/**
 * Parses every composite action.
 *
 * @returns {Map<string, any>} Each action by its directory under `.github/actions`.
 */
function loadActions() {
  const actions = new Map();
  const base = join(ROOT, ACTIONS);
  if (!existsSync(base)) {
    return actions;
  }
  for (const name of readdirSync(base).sort()) {
    for (const file of ['action.yml', 'action.yaml']) {
      const path = join(base, name, file);
      if (existsSync(path)) {
        actions.set(name, parse(readFileSync(path, 'utf8')));
      }
    }
  }
  return actions;
}

/**
 * The jobs of a workflow.
 *
 * @param {any} doc - The parsed workflow.
 * @returns {[string, any][]} Each job with its id.
 */
function jobsOf(doc) {
  return Object.entries(doc?.jobs ?? {});
}

/**
 * The `run:` bodies of a workflow, in order.
 *
 * @param {any} doc - The parsed workflow.
 * @returns {string[]} Every step's shell script.
 */
function runsOf(doc) {
  return jobsOf(doc).flatMap(([, job]) =>
    (job.steps ?? []).map((step) => step.run).filter((run) => typeof run === 'string'),
  );
}

/**
 * The steps of a workflow, in job and declaration order.
 *
 * @param {any} doc - The parsed workflow.
 * @returns {any[]} Every step.
 */
function stepsOf(doc) {
  return jobsOf(doc).flatMap(([, job]) => job.steps ?? []);
}

/**
 * The value a single capture group takes wherever a pattern matches.
 *
 * @param {string[]} texts - The texts to search.
 * @param {RegExp} pattern - A pattern with one capture group and the `g` flag.
 * @returns {string[]} Every captured value, in order.
 */
function captures(texts, pattern) {
  return texts.flatMap((text) => [...text.matchAll(pattern)].map((match) => match[1]));
}

/**
 * Reads a string constant from the app's source.
 *
 * @param {string} source - The source text.
 * @param {string} name - The exported constant.
 * @returns {string | undefined} Its value when it is declared exactly once.
 */
function constantOf(source, name) {
  const values = captures([source], new RegExp(`^export const ${name} = '([^']+)';$`, 'gmu'));
  return values.length === 1 ? values[0] : undefined;
}

/**
 * Reads a private string constant from a script.
 *
 * @param {string} source - The source text.
 * @param {string} name - The constant.
 * @returns {string | undefined} Its value when it is declared exactly once.
 */
function privateConstantOf(source, name) {
  const values = captures([source], new RegExp(`^const ${name} = '([^']+)';$`, 'gmu'));
  return values.length === 1 ? values[0] : undefined;
}

/**
 * Asserts rule 1: the asset names in the release workflows are the app's.
 *
 * @param {Map<string, { text: string, doc: any }>} workflows - Every workflow.
 * @param {Map<string, any>} actions - Every composite action.
 */
function checkNames(workflows, actions) {
  const rule = 'names';
  const source = readText(RELEASE_CHECK);
  const standard = source === undefined ? undefined : constantOf(source, 'STANDARD_APK_ASSET');
  const sms = source === undefined ? undefined : constantOf(source, 'SMS_APK_ASSET');
  check(rule, standard !== undefined, `${RELEASE_CHECK} should export STANDARD_APK_ASSET once`);
  check(rule, sms !== undefined, `${RELEASE_CHECK} should export SMS_APK_ASSET once`);
  if (standard === undefined || sms === undefined) {
    return;
  }
  // GitHub does not document release-asset ordering, so the SMS workflow
  // verifies the actual API response after upload. Keep name sorting safe too
  // as defense in depth for clients up to v0.2.12, which take the first APK.
  check(
    rule,
    standard < sms && standard.localeCompare(sms, 'en', { sensitivity: 'base' }) < 0,
    `${standard} should sort before ${sms}, preserving the standard-first fallback`,
  );

  const standardRuns = runsOf(workflows.get(STANDARD_WORKFLOW)?.doc);
  const smsRuns = runsOf(workflows.get(SMS_WORKFLOW)?.doc);
  const guardRuns = (actions.get(APK_ORDER_ACTION)?.runs?.steps ?? [])
    .map((step) => step.run)
    .filter((run) => typeof run === 'string');
  check(rule, workflows.has(STANDARD_WORKFLOW), `${WORKFLOWS}/${STANDARD_WORKFLOW} is missing`);
  check(rule, workflows.has(SMS_WORKFLOW), `${WORKFLOWS}/${SMS_WORKFLOW} is missing`);
  check(
    rule,
    actions.has(APK_ORDER_ACTION),
    `${ACTIONS}/${APK_ORDER_ACTION}/action.yml is missing`,
  );

  const expectOnly = (runs, pattern, want, what) => {
    const found = captures(runs, pattern);
    check(
      rule,
      found.length === 1 && found[0] === want,
      `${what} should be exactly ${want}, found ${JSON.stringify(found)}`,
    );
  };
  const upload = /gh release upload\s+\S+\s+(\S+)/gu;
  if (workflows.has(STANDARD_WORKFLOW)) {
    expectOnly(standardRuns, upload, standard, `${STANDARD_WORKFLOW} upload`);
  }
  if (workflows.has(SMS_WORKFLOW)) {
    expectOnly(smsRuns, upload, sms, `${SMS_WORKFLOW} upload`);
    expectOnly(smsRuns, /--pattern\s+(\S+)/gu, standard, `${SMS_WORKFLOW} reference download`);
  }
  if (actions.has(APK_ORDER_ACTION)) {
    expectOnly(
      guardRuns,
      /delete-asset\s+\S+\s+(\S+)/gu,
      sms,
      `${APK_ORDER_ACTION} withdrawn asset`,
    );
    expectOnly(guardRuns, /^\s*\*\/(\S+)\)/gmu, standard, `${APK_ORDER_ACTION} first-asset guard`);
  }
  const replacement = readText(STANDARD_REPLACEMENT);
  check(
    rule,
    replacement !== undefined && privateConstantOf(replacement, 'SMS_APK_ASSET') === sms,
    `${STANDARD_REPLACEMENT} should preserve exactly ${sms}`,
  );

  const known = new Set([standard, sms]);
  for (const name of [STANDARD_WORKFLOW, SMS_WORKFLOW, PR_CHECK]) {
    const found = new Set(
      runsOf(workflows.get(name)?.doc).flatMap((run) => run.match(APK_NAME) ?? []),
    );
    for (const asset of found) {
      check(
        rule,
        known.has(asset),
        `${name} names ${asset}, which is neither ${standard} nor ${sms}`,
      );
    }
  }
  for (const asset of new Set(guardRuns.flatMap((run) => run.match(APK_NAME) ?? []))) {
    check(
      rule,
      known.has(asset),
      `${APK_ORDER_ACTION} names ${asset}, which is neither ${standard} nor ${sms}`,
    );
  }
}

/**
 * Resolves the public app config with the SMS flag set or unset.
 *
 * @param {string | undefined} flag - The value of `OTP_SMS_AUTOREAD`, or
 *   `undefined` to leave it unset.
 * @returns {any} The public config.
 */
function publicConfig(flag) {
  const env = { ...process.env };
  // Deleted rather than left alone, so a developer's exported build values
  // cannot change what is checked.
  delete env.OTP_SMS_AUTOREAD;
  delete env.ANDROID_VERSION_CODE;
  if (flag !== undefined) {
    env.OTP_SMS_AUTOREAD = flag;
  }
  // Run through node directly: npx resolves to a .cmd on Windows, which cannot
  // be spawned without a shell.
  const cli = createRequire(import.meta.url).resolve('expo/bin/cli');
  return JSON.parse(
    execFileSync(process.execPath, [cli, 'config', '--type', 'public', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    }),
  );
}

/**
 * Asserts rule 2: each update reaches the channel its APK listens on.
 *
 * @param {Map<string, { text: string, doc: any }>} workflows - Every workflow.
 */
function checkChannel(workflows) {
  const rule = 'channel';
  const smsChannel = publicConfig('1').updates?.requestHeaders?.[CHANNEL_HEADER];
  const defaultChannel = publicConfig(undefined).updates?.requestHeaders?.[CHANNEL_HEADER];
  check(
    rule,
    typeof smsChannel === 'string',
    `the OTP_SMS_AUTOREAD=1 config should set ${CHANNEL_HEADER}`,
  );
  check(
    rule,
    defaultChannel === undefined,
    `the default config should not set ${CHANNEL_HEADER}, which EAS Build sets for the standard APK`,
  );
  const easJson = readText('eas.json');
  const standardChannel =
    easJson === undefined ? undefined : JSON.parse(easJson).build?.[STANDARD_PROFILE]?.channel;
  check(
    rule,
    typeof standardChannel === 'string',
    `eas.json build.${STANDARD_PROFILE}.channel should be set`,
  );

  const ota = workflows.get(OTA_WORKFLOW)?.doc;
  const legs = jobsOf(ota).flatMap(([, job]) => job.strategy?.matrix?.include ?? []);
  const smsLegs = legs.filter((leg) => leg.autoread === '1');
  const standardLegs = legs.filter((leg) => leg.autoread !== '1');
  check(
    rule,
    smsLegs.length === 1 && smsLegs[0].channel === smsChannel && smsLegs[0].platform === 'android',
    `${OTA_WORKFLOW} should have one Android leg with autoread '1' on ${smsChannel}, found ${JSON.stringify(smsLegs)}`,
  );
  check(
    rule,
    standardLegs.length === 1 &&
      standardLegs[0].channel === standardChannel &&
      standardLegs[0].platform === 'all' &&
      standardLegs[0].autoread === '',
    `${OTA_WORKFLOW} should have one all-platform leg with an empty autoread on ${standardChannel}, found ${JSON.stringify(standardLegs)}`,
  );
  // The matrix only matters if the publish command reads it.
  const publish = jobsOf(ota)
    .flatMap(([, job]) => job.steps ?? [])
    .filter((step) => typeof step.run === 'string' && /\beas update\s/u.test(step.run));
  check(
    rule,
    publish.length === 1 &&
      publish[0].env?.CHANNEL === '${{ matrix.channel }}' &&
      publish[0].env?.OTP_SMS_AUTOREAD === '${{ matrix.autoread }}' &&
      publish[0].run.includes('--channel "$CHANNEL"'),
    `${OTA_WORKFLOW} should publish once, with --channel "$CHANNEL" and CHANNEL and OTP_SMS_AUTOREAD from the matrix`,
  );
  // The lookup must follow the channel embedded in the APK. EAS supports
  // remapping that channel to a differently named branch.
  const lookup = readText(UPDATE_LOOKUP);
  const lookupChannel = lookup === undefined ? undefined : privateConstantOf(lookup, 'CHANNEL');
  check(
    rule,
    lookupChannel === smsChannel,
    `${UPDATE_LOOKUP} should resolve channel ${smsChannel}, found ${JSON.stringify(lookupChannel)}`,
  );
}

/**
 * The trigger map of a workflow, whatever form `on:` was written in.
 *
 * @param {any} doc - The parsed workflow.
 * @returns {Record<string, any>} Each event with its configuration.
 */
function triggersOf(doc) {
  const on = doc?.on;
  if (typeof on === 'string') {
    return { [on]: {} };
  }
  if (Array.isArray(on)) {
    return Object.fromEntries(on.map((event) => [event, {}]));
  }
  return on ?? {};
}

/**
 * The job ids a job waits for.
 *
 * @param {any} job - The job.
 * @returns {string[]} Its `needs`, as a list.
 */
function needsOf(job) {
  if (job.needs === undefined) {
    return [];
  }
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

/**
 * The `actions/checkout` steps of a job.
 *
 * @param {any} job - The job.
 * @returns {any[]} Each checkout step.
 */
function checkoutsOf(job) {
  return (job.steps ?? []).filter((step) =>
    String(step.uses ?? '').startsWith('actions/checkout@'),
  );
}

/**
 * Asserts rule 3: a release tag builds only its verified commit.
 *
 * @param {Map<string, { text: string, doc: any }>} workflows - Every workflow.
 */
function checkProvenance(workflows) {
  const rule = 'provenance';
  const verify = workflows.get(VERIFY);
  check(rule, verify !== undefined, `${WORKFLOWS}/${VERIFY} is missing`);
  if (verify !== undefined) {
    check(
      rule,
      jobsOf(verify.doc).every(([, job]) => checkoutsOf(job).length === 0),
      `${VERIFY} should check nothing out`,
    );
    const secrets = captures([verify.text], /secrets\.(\w+)/gu);
    check(
      rule,
      secrets.every((name) => name === 'GITHUB_TOKEN'),
      `${VERIFY} should read no secret but GITHUB_TOKEN, found ${JSON.stringify(secrets)}`,
    );
    // GitHub only passes a step output up when every link names the next.
    const value = String(triggersOf(verify.doc).workflow_call?.outputs?.sha?.value ?? '');
    const jobId = /^\$\{\{ jobs\.([\w-]+)\.outputs\.sha \}\}$/u.exec(value)?.[1];
    const stepOutput = String(verify.doc?.jobs?.[jobId]?.outputs?.sha ?? '');
    const stepId = /^\$\{\{ steps\.([\w-]+)\.outputs\.sha \}\}$/u.exec(stepOutput)?.[1];
    const step = (verify.doc?.jobs?.[jobId]?.steps ?? []).find(
      (candidate) => candidate.id === stepId,
    );
    const run = String(step?.run ?? '');
    check(
      rule,
      jobId !== undefined &&
        stepId !== undefined &&
        run.includes('echo "sha=$sha" >> "$GITHUB_OUTPUT"'),
      `${VERIFY} should map a step's sha= output through its job to on.workflow_call.outputs.sha`,
    );
    check(
      rule,
      run.includes('[ "$EVENT_NAME" = push ] && [ "$sha" != "$HEAD_SHA" ]'),
      `${VERIFY} should refuse a push whose release tag does not point at github.sha`,
    );
  }

  for (const [name, { doc }] of workflows) {
    const triggers = triggersOf(doc);
    const takesTag = ['workflow_call', 'workflow_dispatch'].some(
      (event) => triggers[event]?.inputs?.tag !== undefined,
    );
    if (name === VERIFY || !takesTag) {
      continue;
    }
    const verifiers = jobsOf(doc).filter(([, job]) => job.uses === VERIFY_USES);
    check(
      rule,
      verifiers.length === 1 && verifiers[0][1].with?.tag === '${{ inputs.tag }}',
      `${name} takes a release tag, so it should have one job calling ${VERIFY_USES} with tag: \${{ inputs.tag }}`,
    );
    const verifierId = verifiers[0]?.[0];
    for (const [id, job] of jobsOf(doc)) {
      const checkouts = checkoutsOf(job);
      if (checkouts.length === 0) {
        continue;
      }
      check(
        rule,
        verifierId !== undefined && needsOf(job).includes(verifierId),
        `${name} job ${id} checks out code, so it should need the verify job`,
      );
      for (const step of checkouts) {
        check(
          rule,
          verifierId !== undefined && step.with?.ref === `\${{ needs.${verifierId}.outputs.sha }}`,
          `${name} job ${id} should check out ref: \${{ needs.<verify job>.outputs.sha }}, not ${JSON.stringify(step.with?.ref ?? null)}`,
        );
      }
    }
  }
}

/**
 * Asserts rule 4: every `gh` step has a token of its own or from its job.
 *
 * @param {Map<string, { text: string, doc: any }>} workflows - Every workflow.
 * @param {Map<string, any>} actions - Every composite action.
 */
function checkToken(workflows, actions) {
  const rule = 'token';
  const workflowSteps = [...workflows].flatMap(([name, { doc }]) =>
    jobsOf(doc).flatMap(([id, job]) =>
      (job.steps ?? []).map((step, index) => ({
        where: `${name} job ${id} step ${index + 1}`,
        step,
        job,
      })),
    ),
  );
  const steps = [
    ...workflowSteps,
    ...[...actions].flatMap(([name, action]) =>
      (action?.runs?.steps ?? []).map((step, index) => ({
        where: `${ACTIONS}/${name} step ${index + 1}`,
        step,
        job: {},
      })),
    ),
  ];
  for (const { where, step, job } of steps) {
    if (typeof step.run === 'string' && GH_COMMAND.test(step.run)) {
      check(
        rule,
        step.env?.GH_TOKEN !== undefined || job.env?.GH_TOKEN !== undefined,
        `${where}${step.name === undefined ? '' : ` (${step.name})`} runs gh, so it or its job should set GH_TOKEN`,
      );
    }
  }
  for (const [name, { doc }] of workflows) {
    check(
      rule,
      doc?.env?.EXPO_TOKEN === undefined,
      `${name} should not expose EXPO_TOKEN to every job`,
    );
    for (const [id, job] of jobsOf(doc)) {
      check(
        rule,
        job.env?.EXPO_TOKEN === undefined,
        `${name} job ${id} should not expose EXPO_TOKEN to every step`,
      );
    }
  }
  for (const { where, step } of workflowSteps) {
    if (typeof step.uses === 'string' && step.uses.startsWith(EXPO_ACTION)) {
      check(
        rule,
        step.with?.token === undefined,
        `${where} should install EAS without exporting EXPO_TOKEN job-wide`,
      );
    }
    const run = typeof step.run === 'string' ? step.run : '';
    const invokesEas = EAS_COMMAND.test(run) || run.includes(`node ${UPDATE_LOOKUP}`);
    const token = step.env?.EXPO_TOKEN;
    if (invokesEas) {
      check(
        rule,
        token === EXPO_TOKEN_SECRET,
        `${where}${step.name === undefined ? '' : ` (${step.name})`} invokes EAS, so it should set EXPO_TOKEN only for that step`,
      );
    }
    if (token === EXPO_TOKEN_SECRET) {
      check(
        rule,
        step.name === 'Gate on EXPO_TOKEN' || invokesEas,
        `${where}${step.name === undefined ? '' : ` (${step.name})`} receives EXPO_TOKEN without invoking EAS`,
      );
      if (invokesEas) {
        check(
          rule,
          expoTokenRunIsNarrow(run),
          `${where}${step.name === undefined ? '' : ` (${step.name})`} should invoke only its trusted EAS entry point`,
        );
      }
    }
  }
  for (const unsafe of [
    'MESSAGE=`head -n 1 <<<"$HEAD_MESSAGE"`\neas update --branch "$BRANCH"',
    'eas update --branch "$BRANCH" --message <(head -n 1 message.txt)',
    'node -e "process.exit(0)"\neas update --branch "$BRANCH"',
    'eas update --branch "$BRANCH" | head -n 1',
    'MESSAGE=$(head -n 1 <<<"$HEAD_MESSAGE")\neas update --branch "$BRANCH"',
    'eas update --channel production & node -e "process.exit(0)"',
    'eas branch:delete "$BRANCH" || echo "missing"',
  ]) {
    check(
      rule,
      !expoTokenRunIsNarrow(unsafe),
      'the EXPO_TOKEN oracle should reject unrelated shell child processes',
    );
  }
}

/**
 * Asserts rule 5: the pull-request build check can reach no secret.
 *
 * @param {Map<string, { text: string, doc: any }>} workflows - Every workflow.
 */
function checkIsolation(workflows) {
  const rule = 'isolation';
  const workflow = workflows.get(PR_CHECK);
  check(rule, workflow !== undefined, `${WORKFLOWS}/${PR_CHECK} is missing`);
  if (workflow === undefined) {
    return;
  }
  check(rule, !workflow.text.includes('secrets.'), `${PR_CHECK} should reference no secrets.*`);
  check(
    rule,
    jobsOf(workflow.doc).every(
      ([, job]) => job.environment === undefined && job.permissions === undefined,
    ),
    `${PR_CHECK} jobs should name no environment and widen no permission`,
  );
  const events = Object.keys(triggersOf(workflow.doc));
  check(
    rule,
    events.length === 1 && events[0] === 'pull_request',
    `${PR_CHECK} should run on pull_request only, which gives fork runs no secret, found ${JSON.stringify(events)}`,
  );
  check(
    rule,
    JSON.stringify(workflow.doc?.permissions) === JSON.stringify({ contents: 'read' }),
    `${PR_CHECK} should grant contents: read and nothing else`,
  );
}

/**
 * Asserts rule 6: release-please calls the SMS build after its two inputs.
 *
 * @param {Map<string, { text: string, doc: any }>} workflows - Every workflow.
 */
function checkOrchestration(workflows) {
  const rule = 'orchestration';
  const workflow = workflows.get(RELEASE_WORKFLOW);
  check(rule, workflow !== undefined, `${WORKFLOWS}/${RELEASE_WORKFLOW} is missing`);
  if (workflow === undefined) {
    return;
  }

  const jobs = Object.fromEntries(jobsOf(workflow.doc));
  check(
    rule,
    jobs.apk?.uses === `./${WORKFLOWS}/${STANDARD_WORKFLOW}`,
    `${RELEASE_WORKFLOW} job apk should call ${STANDARD_WORKFLOW}`,
  );
  check(
    rule,
    jobs.ota?.uses === `./${WORKFLOWS}/${OTA_WORKFLOW}`,
    `${RELEASE_WORKFLOW} job ota should call ${OTA_WORKFLOW}`,
  );

  const smsCalls = jobsOf(workflow.doc).filter(
    ([, job]) => job.uses === `./${WORKFLOWS}/${SMS_WORKFLOW}`,
  );
  check(
    rule,
    smsCalls.length === 1,
    `${RELEASE_WORKFLOW} should call ${SMS_WORKFLOW} exactly once`,
  );
  const sms = smsCalls[0]?.[1];
  if (sms === undefined) {
    return;
  }

  check(
    rule,
    JSON.stringify(needsOf(sms).sort()) === JSON.stringify(['apk', 'ota', 'release-please']),
    `${RELEASE_WORKFLOW} SMS job should need release-please, apk and ota`,
  );
  check(
    rule,
    sms.if === "needs.release-please.outputs.release_created == 'true'",
    `${RELEASE_WORKFLOW} SMS job should run only when release-please created a release`,
  );
  check(
    rule,
    sms.with?.tag === '${{ needs.release-please.outputs.tag_name }}',
    `${RELEASE_WORKFLOW} SMS job should pass release-please's tag_name`,
  );
  check(
    rule,
    JSON.stringify(sms.permissions) === JSON.stringify({ contents: 'write' }),
    `${RELEASE_WORKFLOW} SMS job should grant contents: write and nothing else`,
  );
  check(
    rule,
    JSON.stringify(sms.secrets) === JSON.stringify({ EXPO_TOKEN: '${{ secrets.EXPO_TOKEN }}' }),
    `${RELEASE_WORKFLOW} SMS job should pass only EXPO_TOKEN`,
  );
}

/**
 * Asserts rule 7: every APK mutation is serialized and checked fail closed.
 *
 * @param {Map<string, { text: string, doc: any }>} workflows - Every workflow.
 * @param {Map<string, any>} actions - Every composite action.
 */
function checkAssetSafety(workflows, actions) {
  const rule = 'asset safety';
  const standard = workflows.get(STANDARD_WORKFLOW)?.doc;
  const sms = workflows.get(SMS_WORKFLOW)?.doc;
  const replacementSource = readText(STANDARD_REPLACEMENT);
  check(
    rule,
    replacementSource?.includes('export function runCommandToFile') === true &&
      replacementSource.includes("stdio: ['ignore', descriptor, 'pipe']"),
    `${STANDARD_REPLACEMENT} should stream large APK downloads to a private file`,
  );
  const largeDownloadDirectory = mkdtempSync(join(tmpdir(), 'release-asset-oracle-'));
  const largeDownload = join(largeDownloadDirectory, 'large.apk');
  try {
    const expectedSize = 2 * 1024 * 1024;
    runCommandToFile(
      process.execPath,
      ['--eval', `process.stdout.write(Buffer.alloc(${String(expectedSize)}, 97))`],
      largeDownload,
    );
    check(
      rule,
      statSync(largeDownload).size === expectedSize,
      `${STANDARD_REPLACEMENT} should stream an APK larger than the child-process buffer`,
    );
  } catch {
    check(
      rule,
      false,
      `${STANDARD_REPLACEMENT} should stream an APK larger than the child-process buffer`,
    );
  } finally {
    rmSync(largeDownloadDirectory, { recursive: true, force: true });
  }
  const group = standard?.concurrency?.group;
  check(
    rule,
    typeof group === 'string' && group.includes('${{ inputs.tag }}'),
    `${STANDARD_WORKFLOW} should serialize uploads by inputs.tag`,
  );
  check(
    rule,
    sms?.concurrency?.group === group,
    `${STANDARD_WORKFLOW} and ${SMS_WORKFLOW} should use the same concurrency group`,
  );
  check(
    rule,
    standard?.concurrency?.['cancel-in-progress'] === false &&
      sms?.concurrency?.['cancel-in-progress'] === false,
    'APK upload workflows should not cancel an in-progress release mutation',
  );

  const guard = actions.get(APK_ORDER_ACTION);
  check(rule, guard !== undefined, `${ACTIONS}/${APK_ORDER_ACTION}/action.yml is missing`);
  const guardRun = (guard?.runs?.steps ?? [])
    .map((step) => step.run)
    .filter((run) => typeof run === 'string')
    .join('\n');
  check(
    rule,
    guardRun.includes('.assets[].browser_download_url') &&
      guardRun.includes('select(endswith(".apk"))') &&
      guardRun.includes('delete-asset') &&
      (guardRun.match(/\bexit 1\b/gu) ?? []).length === 2,
    `${APK_ORDER_ACTION} should inspect the first APK, withdraw the SMS asset and fail on unsafe order`,
  );

  for (const [name, doc] of [
    [STANDARD_WORKFLOW, standard],
    [SMS_WORKFLOW, sms],
  ]) {
    const steps = stepsOf(doc);
    const uploadIndex = steps.findIndex(
      (step) => typeof step.run === 'string' && /\bgh release upload\b/u.test(step.run),
    );
    const guards = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.uses === `./${ACTIONS}/${APK_ORDER_ACTION}`);
    const expectedGuardCondition =
      name === STANDARD_WORKFLOW
        ? "always() && steps.guard.outputs.run == 'true' && steps.upload.outcome == 'success'"
        : "steps.guard.outputs.run == 'true'";
    check(rule, uploadIndex >= 0, `${name} should upload one APK`);
    check(
      rule,
      guards.length === 1 &&
        guards[0].index > uploadIndex &&
        guards[0].step.if === expectedGuardCondition &&
        guards[0].step.with?.release_tag === '${{ inputs.tag }}' &&
        guards[0].step.with?.github_token === '${{ secrets.GITHUB_TOKEN }}',
      `${name} should run ${APK_ORDER_ACTION} once after upload with the release tag and GitHub token`,
    );
  }

  const standardSteps = stepsOf(standard);
  const prepareIndex = standardSteps.findIndex(
    (step) =>
      typeof step.run === 'string' && step.run.includes(`node ${STANDARD_REPLACEMENT} --prepare`),
  );
  const standardUploadIndex = standardSteps.findIndex(
    (step) => typeof step.run === 'string' && /\bgh release upload\b/u.test(step.run),
  );
  const restoreIndex = standardSteps.findIndex(
    (step) =>
      typeof step.run === 'string' && step.run.includes(`node ${STANDARD_REPLACEMENT} --restore`),
  );
  const standardGuardIndex = standardSteps.findIndex(
    (step) => step.uses === `./${ACTIONS}/${APK_ORDER_ACTION}`,
  );
  const backupCleanup = standardSteps.find((step) => step.name === 'Remove the preserved SMS APK');
  check(
    rule,
    prepareIndex >= 0 &&
      prepareIndex < standardUploadIndex &&
      standardUploadIndex < restoreIndex &&
      restoreIndex < standardGuardIndex,
    `${STANDARD_WORKFLOW} should withdraw SMS before standard clobber and restore it before the final guard`,
  );
  check(
    rule,
    standardSteps[restoreIndex]?.if ===
      "success() && steps.prepare-upload.outputs.restore_sms == 'true'",
    `${STANDARD_WORKFLOW} should restore SMS only after a successful standard upload`,
  );
  check(
    rule,
    backupCleanup?.if === "always() && steps.guard.outputs.run == 'true'" &&
      backupCleanup.run === 'rm -rf "$RUNNER_TEMP/release-asset-backup"',
    `${STANDARD_WORKFLOW} should always remove its private SMS backup`,
  );
  // The backup dies with the runner, so a run that withdrew the SMS APK and
  // failed must say so, and say how to put it back, before the cleanup step.
  const recoveryIndex = standardSteps.findIndex(
    (step) => step.name === 'Explain how to restore the SMS APK',
  );
  const recovery = standardSteps[recoveryIndex];
  const backupCleanupIndex = standardSteps.indexOf(backupCleanup);
  check(
    rule,
    recoveryIndex > standardGuardIndex &&
      recoveryIndex < backupCleanupIndex &&
      recovery?.if ===
        "(failure() || cancelled()) && steps.prepare-upload.outputs.restore_sms == 'true'" &&
      typeof recovery.run === 'string' &&
      recovery.run.includes('::error') &&
      recovery.run.includes('$GITHUB_STEP_SUMMARY') &&
      recovery.run.includes('Release APK') &&
      recovery.run.includes('Release SMS APK') &&
      !recovery.run.includes('${{'),
    `${STANDARD_WORKFLOW} should explain how to restore a withdrawn SMS APK when it fails`,
  );

  const events = [];
  const prepared = prepareStandardApkReplacement(
    {
      assets: [
        {
          id: 17,
          name: 'israeli-bank-importer.sms.apk',
          size: 4,
        },
      ],
    },
    {
      downloadToBackup: () => {
        events.push('download');
      },
      readBackupSize: () => {
        events.push('measure');
        return 4;
      },
      deleteAsset: () => events.push('delete'),
    },
  );
  check(
    rule,
    prepared && JSON.stringify(events) === JSON.stringify(['download', 'measure', 'delete']),
    `${STANDARD_REPLACEMENT} should download and measure SMS before withdrawing it`,
  );
  let deletedAfterBadDownload = false;
  try {
    prepareStandardApkReplacement(
      {
        assets: [
          {
            id: 17,
            name: 'israeli-bank-importer.sms.apk',
            size: 5,
          },
        ],
      },
      {
        downloadToBackup: () => undefined,
        readBackupSize: () => 3,
        deleteAsset: () => {
          deletedAfterBadDownload = true;
        },
      },
    );
  } catch {
    // The size mismatch is the expected fail-closed path.
  }
  check(
    rule,
    !deletedAfterBadDownload,
    `${STANDARD_REPLACEMENT} should never delete SMS after an incomplete download`,
  );

  const malformedReleases = [
    {
      description: 'a null asset after the SMS asset',
      release: {
        assets: [{ id: 17, name: 'israeli-bank-importer.sms.apk', size: 4 }, null],
      },
    },
    {
      description: 'a non-numeric asset id',
      release: {
        assets: [
          { id: 17, name: 'israeli-bank-importer.sms.apk', size: 4 },
          { id: '18', name: 'release-notes.txt', size: 1 },
        ],
      },
    },
    {
      description: 'a zero asset id',
      release: {
        assets: [
          { id: 17, name: 'israeli-bank-importer.sms.apk', size: 4 },
          { id: 0, name: 'release-notes.txt', size: 1 },
        ],
      },
    },
    {
      description: 'a negative asset id',
      release: {
        assets: [
          { id: 17, name: 'israeli-bank-importer.sms.apk', size: 4 },
          { id: -1, name: 'release-notes.txt', size: 1 },
        ],
      },
    },
    {
      description: 'a fractional asset id',
      release: {
        assets: [
          { id: 17, name: 'israeli-bank-importer.sms.apk', size: 4 },
          { id: 18.5, name: 'release-notes.txt', size: 1 },
        ],
      },
    },
    {
      description: 'an unsafe asset id',
      release: {
        assets: [
          { id: 17, name: 'israeli-bank-importer.sms.apk', size: 4 },
          { id: Number.MAX_SAFE_INTEGER + 1, name: 'release-notes.txt', size: 1 },
        ],
      },
    },
    {
      description: 'a non-string asset name',
      release: {
        assets: [
          { id: 17, name: 'israeli-bank-importer.sms.apk', size: 4 },
          { id: 18, name: 19, size: 1 },
        ],
      },
    },
    {
      description: 'an empty asset name',
      release: {
        assets: [
          { id: 17, name: 'israeli-bank-importer.sms.apk', size: 4 },
          { id: 18, name: '', size: 1 },
        ],
      },
    },
    {
      description: 'a non-numeric asset size',
      release: {
        assets: [
          { id: 17, name: 'israeli-bank-importer.sms.apk', size: 4 },
          { id: 18, name: 'release-notes.txt', size: '1' },
        ],
      },
    },
    {
      description: 'a negative asset size',
      release: {
        assets: [
          { id: 17, name: 'israeli-bank-importer.sms.apk', size: 4 },
          { id: 18, name: 'release-notes.txt', size: -1 },
        ],
      },
    },
    {
      description: 'a fractional asset size',
      release: {
        assets: [
          { id: 17, name: 'israeli-bank-importer.sms.apk', size: 4 },
          { id: 18, name: 'release-notes.txt', size: 1.5 },
        ],
      },
    },
    {
      description: 'an unsafe asset size',
      release: {
        assets: [
          { id: 17, name: 'israeli-bank-importer.sms.apk', size: 4 },
          { id: 18, name: 'release-notes.txt', size: Number.MAX_SAFE_INTEGER + 1 },
        ],
      },
    },
    {
      description: 'an empty SMS asset',
      release: { assets: [{ id: 17, name: 'israeli-bank-importer.sms.apk', size: 0 }] },
    },
    {
      description: 'duplicate asset ids',
      release: {
        assets: [
          { id: 17, name: 'israeli-bank-importer.sms.apk', size: 4 },
          { id: 17, name: 'release-notes.txt', size: 3 },
        ],
      },
    },
    {
      description: 'duplicate asset names',
      release: {
        assets: [
          { id: 17, name: 'israeli-bank-importer.sms.apk', size: 4 },
          { id: 18, name: 'israeli-bank-importer.sms.apk', size: 3 },
        ],
      },
    },
  ];
  for (const { description, release } of malformedReleases) {
    let rejected = false;
    let touchedRemoteState = false;
    try {
      prepareStandardApkReplacement(release, {
        downloadToBackup: () => {
          touchedRemoteState = true;
        },
        readBackupSize: () => {
          touchedRemoteState = true;
          return 4;
        },
        deleteAsset: () => {
          touchedRemoteState = true;
        },
      });
    } catch {
      rejected = true;
    }
    check(
      rule,
      rejected && !touchedRemoteState,
      `${STANDARD_REPLACEMENT} should reject ${description} before any side effect`,
    );
  }
  const smsAbsent = prepareStandardApkReplacement(
    { assets: [{ id: 25, name: 'release-notes.txt', size: 0 }] },
    {
      downloadToBackup: () => {
        throw new Error('A valid unrelated asset must not be downloaded.');
      },
      readBackupSize: () => {
        throw new Error('A valid unrelated asset must not be measured.');
      },
      deleteAsset: () => {
        throw new Error('A valid unrelated asset must not be deleted.');
      },
    },
  );
  check(
    rule,
    !smsAbsent,
    `${STANDARD_REPLACEMENT} should report SMS absent only after validating every asset`,
  );
}

/**
 * Asserts rule 8: the SMS workflow delegates to the paginated update lookup.
 *
 * @param {Map<string, { text: string, doc: any }>} workflows - Every workflow.
 */
function checkUpdateLookup(workflows) {
  const rule = 'update lookup';
  check(rule, readText(UPDATE_LOOKUP) !== undefined, `${UPDATE_LOOKUP} is missing`);
  const matches = stepsOf(workflows.get(SMS_WORKFLOW)?.doc).filter(
    (step) =>
      typeof step.run === 'string' &&
      (step.run.includes('eas update:list') || step.run.includes(UPDATE_LOOKUP)),
  );
  check(
    rule,
    matches.length === 1 &&
      matches[0].run.trim() === `node ${UPDATE_LOOKUP}` &&
      matches[0].env?.RELEASE_TAG === '${{ inputs.tag }}' &&
      matches[0].env?.BUILD_SHA === '${{ needs.verify.outputs.sha }}' &&
      matches[0].env?.RUNTIME === '${{ steps.build.outputs.runtime }}',
    `${SMS_WORKFLOW} should run ${UPDATE_LOOKUP} once with the release tag, build SHA and runtime`,
  );

  const identity = {
    releaseTag: 'israeli-bank-importer-app-v9.9.9',
    buildSha: '0123456789abcdef0123456789abcdef01234567',
    runtime: 'fedcba9876543210fedcba9876543210fedcba98',
  };
  const firstPage = Array.from({ length: 50 }, (_, index) => `old-group-${index}`);
  const matchingGroup = 'matching-group-after-first-page';
  const mappedBranch = 'sms-release-v2';
  check(
    rule,
    branchFromChannelView({
      currentPage: { updateBranches: [{ name: mappedBranch }] },
    }) === mappedBranch,
    `${UPDATE_LOOKUP} should read the branch currently mapped to the SMS channel`,
  );
  let rolloutRejected = false;
  try {
    branchFromChannelView({
      currentPage: {
        updateBranches: [{ name: 'sms-stable' }, { name: 'sms-rollout' }],
      },
    });
  } catch (error) {
    rolloutRejected = error instanceof Error && error.message.includes('expected exactly one');
  }
  check(
    rule,
    rolloutRejected,
    `${UPDATE_LOOKUP} should fail closed while a channel maps to multiple rollout branches`,
  );
  const requests = [];
  const found = findMatchingUpdate(identity, {
    resolveBranch: () => mappedBranch,
    listGroups: (branch, offset, limit) => {
      requests.push([branch, offset, limit]);
      return offset === 0 ? firstPage : [matchingGroup];
    },
    readGroup: (group) =>
      group === matchingGroup
        ? [
            {
              branch: mappedBranch,
              platform: 'android',
              runtimeVersion: identity.runtime,
              message: identity.releaseTag,
              gitCommitHash: identity.buildSha,
            },
          ]
        : [],
  });
  check(
    rule,
    found.branch === mappedBranch &&
      found.group === matchingGroup &&
      JSON.stringify(requests) ===
        JSON.stringify([
          [mappedBranch, 0, 50],
          [mappedBranch, 50, 50],
        ]),
    `${UPDATE_LOOKUP} should follow the channel mapping and find a match after a full first page`,
  );

  const exhaustedRequests = [];
  const exhausted = findMatchingUpdate(identity, {
    resolveBranch: () => mappedBranch,
    listGroups: (branch, offset, limit) => {
      exhaustedRequests.push([branch, offset, limit]);
      return firstPage.slice(0, 49);
    },
    readGroup: () => [],
  });
  check(
    rule,
    exhausted.branch === mappedBranch &&
      exhausted.group === null &&
      JSON.stringify(exhaustedRequests) === JSON.stringify([[mappedBranch, 0, 50]]),
    `${UPDATE_LOOKUP} should stop without another request after a short final page`,
  );
}

/**
 * Asserts rule 9: the local build never leaves its generated Android project.
 */
function checkBuildHygiene() {
  const rule = 'build hygiene';
  const source = readText(SMS_BUILD_SCRIPT);
  check(rule, source !== undefined, `${SMS_BUILD_SCRIPT} is missing`);
  if (source === undefined) {
    return;
  }
  const mainStart = source.indexOf('async function main(');
  const finallyStart = source.indexOf('  } finally {', mainStart);
  const reportStart = source.indexOf('/**\n * Reports a failure', finallyStart);
  const finallyBody =
    mainStart >= 0 && finallyStart >= 0 && reportStart >= 0
      ? source.slice(finallyStart, reportStart)
      : undefined;
  check(
    rule,
    finallyBody?.includes('rmSync(ANDROID_DIR, { recursive: true, force: true });') === true,
    `${SMS_BUILD_SCRIPT} should recursively remove ANDROID_DIR in its main finally block`,
  );
  check(
    rule,
    /function run\(\s*command,\s*args,\s*\{\s*env = sanitizedEnvironment\(\),\s*cwd = ROOT,\s*binary = false\s*\}\s*=\s*\{\},?\s*\)\s*\{/mu.test(
      source,
    ),
    `${SMS_BUILD_SCRIPT} should remove signing passwords from the default short-command environment`,
  );
  check(
    rule,
    (source.match(/\benv: signingEnvironment\(\)/gu) ?? []).length === 2,
    `${SMS_BUILD_SCRIPT} should expose signing passwords to exactly keytool export and apksigner sign`,
  );
  check(
    rule,
    !/\benv\s*[:=]\s*process\.env\b/u.test(source),
    `${SMS_BUILD_SCRIPT} should never pass the complete parent environment to a child`,
  );
}

/**
 * Asserts rule 10: equal certificates do not hide different signing schemes.
 *
 * @param {Map<string, { text: string, doc: any }>} workflows - Every workflow.
 */
function checkSignatureProfile(workflows) {
  const rule = 'signature profile';
  const digest = 'a'.repeat(64);
  const v2Only = parseApkSignatureProfile(`Verified
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): false
Verified using v3.1 scheme (APK Signature Scheme v3.1): false
Verified using v4 scheme (APK Signature Scheme v4): false
Signer #1 certificate SHA-256 digest: ${digest}
`);
  const v2AndV3 = parseApkSignatureProfile(`Verified
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Verified using v3.1 scheme (APK Signature Scheme v3.1): false
Verified using v4 scheme (APK Signature Scheme v4): false
Signer #1 certificate SHA-256 digest: ${digest}
`);
  check(
    rule,
    v2Only.signers.length === 1 && v2Only.signers[0] === digest,
    'the apksigner profile parser should preserve the certificate digest',
  );
  check(
    rule,
    !sameSigningSchemes(v2Only.schemes, v2AndV3.schemes),
    'the same certificate with v2-only and v2+v3 should not have the same signature profile',
  );
  check(
    rule,
    isMissingSigningLineageError('The provided APK does not contain a valid lineage.') &&
      isMissingSigningLineageError(
        'The provided APK does not contain a valid V3 nor V3.1 signature block.',
      ) &&
      !isMissingSigningLineageError('Unable to locate a Java Runtime.'),
    'the lineage classifier should allow only Build Tools no-lineage outcomes',
  );
  check(
    rule,
    JSON.stringify(signingSchemeArguments(v2Only.schemes)) ===
      JSON.stringify([
        '--v1-signing-enabled',
        'false',
        '--v2-signing-enabled',
        'true',
        '--v3-signing-enabled',
        'false',
        '--v4-signing-enabled',
        'false',
      ]),
    'the standard profile should become explicit apksigner flags',
  );

  const source = readText(SMS_BUILD_SCRIPT);
  check(rule, source !== undefined, `${SMS_BUILD_SCRIPT} is missing`);
  if (source === undefined) {
    return;
  }
  check(
    rule,
    source.includes("'verify', '--verbose', '--print-certs'"),
    `${SMS_BUILD_SCRIPT} should ask apksigner for the verified scheme flags`,
  );
  check(
    rule,
    source.includes('sameSigningSchemes(expected.schemes, profile.schemes)'),
    `${SMS_BUILD_SCRIPT} should compare the reference and generated signing schemes`,
  );
  check(
    rule,
    source.includes('...signingSchemeArguments(expected.schemes)'),
    `${SMS_BUILD_SCRIPT} should sign with the reference APK's supported scheme profile`,
  );
  check(
    rule,
    source.includes('hasSigningLineage(apksigner, apk)') &&
      source.includes('The standard APK uses an unsupported signing-key lineage'),
    `${SMS_BUILD_SCRIPT} should fail closed when the standard APK contains a v3 lineage`,
  );

  const comparison = readText(APK_SIGNATURE_CHECK);
  check(rule, comparison !== undefined, `${APK_SIGNATURE_CHECK} is missing`);
  check(
    rule,
    comparison?.includes("['lineage', '--in', apk, '--print-certs']") === true &&
      comparison.includes('signing-key lineage is unsupported'),
    `${APK_SIGNATURE_CHECK} should reject v3 and v3.1 signing-key lineages`,
  );
  const profileSource = readText(APK_SIGNATURE_PROFILE);
  check(
    rule,
    profileSource?.includes('export function isMissingSigningLineageError') === true &&
      profileSource.includes('The provided APK does not contain a valid lineage.') &&
      profileSource.includes(
        'The provided APK does not contain a valid V3 nor V3.1 signature block.',
      ),
    `${APK_SIGNATURE_PROFILE} should distinguish an absent lineage from a tool failure`,
  );
  const prCheck = workflows.get(PR_CHECK);
  const prPaths = prCheck?.doc?.on?.pull_request?.paths ?? [];
  const buildRun = stepsOf(prCheck?.doc)
    .map((step) => step.run)
    .filter((run) => typeof run === 'string')
    .join('\n');
  check(
    rule,
    prPaths.includes(APK_SIGNATURE_CHECK) && prPaths.includes(APK_SIGNATURE_PROFILE),
    `${PR_CHECK} should run when either signature-profile script changes`,
  );
  check(
    rule,
    buildRun.includes('--v3-signing-enabled true') &&
      buildRun.includes(`node ${APK_SIGNATURE_CHECK}`) &&
      buildRun.includes('accepted a same-certificate APK with a different signing profile'),
    `${PR_CHECK} should reject a real same-certificate APK whose v3 flag differs`,
  );
  check(
    rule,
    buildRun.includes('apksigner" rotate') &&
      buildRun.includes('--rotation-min-sdk-version 28') &&
      buildRun.includes('accepted an APK with an unsupported signing-key lineage') &&
      buildRun.includes('signing-key lineage is unsupported'),
    `${PR_CHECK} should reject a real v3 APK carrying a proof-of-rotation lineage`,
  );
}

/**
 * Asserts rule 11: signing material exists only around the direct builder.
 *
 * @param {Map<string, { text: string, doc: any }>} workflows - Every workflow.
 */
function checkSecretBoundary(workflows) {
  const rule = 'secret boundary';
  const sms = workflows.get(SMS_WORKFLOW)?.doc;
  const steps = stepsOf(sms);
  const guard = steps.find((step) => step.name === 'Gate on EXPO_TOKEN');
  const pullIndex = steps.findIndex((step) => step.name === 'Pull the production EAS environment');
  const keyIndex = steps.findIndex((step) => step.name === 'Write the upload keystore');
  const buildIndex = steps.findIndex(
    (step) => step.name === 'Build the SMS APK (Gradle on this runner)',
  );
  const cleanupIndex = steps.findIndex((step) => step.name === 'Remove the build credentials');
  const lookupIndex = steps.findIndex(
    (step) => step.name === 'Check the matching update serves production-sms',
  );
  const pull = steps[pullIndex];
  const build = steps[buildIndex];
  const cleanup = steps[cleanupIndex];
  const lookup = steps[lookupIndex];
  const expectedBuildRun =
    'node --env-file="$RUNNER_TEMP/eas-production.env" scripts/build-sms-apk.mjs ' +
    '--reference "$RUNNER_TEMP/reference/israeli-bank-importer.apk" ' +
    '--out israeli-bank-importer.sms.apk';
  check(
    rule,
    JSON.stringify(guard?.env) === JSON.stringify({ EXPO_TOKEN: EXPO_TOKEN_SECRET }) &&
      !guard?.run?.includes('ANDROID_'),
    `${SMS_WORKFLOW} should gate only on EXPO_TOKEN before any signing secret is materialized`,
  );
  check(
    rule,
    pullIndex >= 0 &&
      pullIndex < keyIndex &&
      keyIndex < buildIndex &&
      buildIndex < cleanupIndex &&
      cleanupIndex < lookupIndex,
    `${SMS_WORKFLOW} should pull EAS variables before creating the key, then remove credentials before the later update lookup`,
  );
  check(
    rule,
    typeof pull?.run === 'string' &&
      pull.run.includes('umask 077') &&
      pull.run.includes('eas env:pull --environment production') &&
      pull.run.includes('--path "$RUNNER_TEMP/eas-production.env"') &&
      JSON.stringify(pull.env) === JSON.stringify({ EXPO_TOKEN: EXPO_TOKEN_SECRET }),
    `${SMS_WORKFLOW} should pull production variables into a private file with only EXPO_TOKEN`,
  );
  check(
    rule,
    typeof build?.run === 'string' &&
      JSON.stringify(logicalShellLines(build.run)) === JSON.stringify([expectedBuildRun]) &&
      build.env?.EXPO_TOKEN === '',
    `${SMS_WORKFLOW} should invoke only Node from the pulled environment with EXPO_TOKEN removed`,
  );
  check(
    rule,
    lookup?.env?.EXPO_TOKEN === EXPO_TOKEN_SECRET,
    `${SMS_WORKFLOW} should restore EXPO_TOKEN only for the post-cleanup EAS update lookup`,
  );
  check(
    rule,
    cleanup?.if === "always() && steps.guard.outputs.run == 'true'" &&
      typeof cleanup.run === 'string' &&
      cleanup.run.includes('$RUNNER_TEMP/upload.keystore') &&
      cleanup.run.includes('$RUNNER_TEMP/eas-production.env') &&
      cleanup.run.includes('.eas/.env'),
    `${SMS_WORKFLOW} should remove the key and pulled environment before later release checks`,
  );

  const buildSource = readText(SMS_BUILD_SCRIPT);
  const comparisonSource = readText(APK_SIGNATURE_CHECK);
  check(
    rule,
    buildSource?.includes('appendFileSync(output, `runtime=${summary.runtime}\\n`);') === true,
    `${SMS_BUILD_SCRIPT} should write its verified runtime directly to GITHUB_OUTPUT`,
  );
  check(
    rule,
    buildSource?.includes(
      "const SECRET_ENV = ['ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_PASSWORD', 'EXPO_TOKEN'];",
    ) === true,
    `${SMS_BUILD_SCRIPT} should remove the Expo token as well as signing passwords from children`,
  );
  check(
    rule,
    comparisonSource?.includes("'ANDROID_KEYSTORE_PASSWORD'") === true &&
      comparisonSource.includes("'ANDROID_KEY_PASSWORD'") &&
      comparisonSource.includes("'EXPO_TOKEN'"),
    `${APK_SIGNATURE_CHECK} should remove every release credential from apksigner verification`,
  );
}

try {
  const workflows = loadWorkflows();
  const actions = loadActions();
  checkNames(workflows, actions);
  checkChannel(workflows);
  checkProvenance(workflows);
  checkToken(workflows, actions);
  checkIsolation(workflows);
  checkOrchestration(workflows);
  checkAssetSafety(workflows, actions);
  checkUpdateLookup(workflows);
  checkBuildHygiene();
  checkSignatureProfile(workflows);
  checkSecretBoundary(workflows);

  if (failures.length > 0) {
    console.error(
      'The release workflows do not match the app or each other:\n' +
        failures.map((failure) => `  - ${failure}`).join('\n') +
        '\n\nNo individual compiler or workflow schema check proves these release invariants.',
    );
    process.exitCode = 1;
  } else {
    console.log(
      'Release workflows agree with the app: asset names, update channels, tag\n' +
        'provenance, gh tokens, pull-request isolation, orchestration, asset safety,\n' +
        'paginated update lookup, local build hygiene, APK signature profiles and\n' +
        'release-secret boundaries all hold.',
    );
  }
} catch (error) {
  console.error(`Could not check the release workflows: ${error.message}`);
  process.exitCode = 1;
}
