/**
 * Banks editor: lists configured banks, lets the user add one from the catalog,
 * edit its credential fields and targets, save (via the config PUT), or remove it
 * (via the bank DELETE endpoint). Bank/target fields come from the manifest's
 * `bankMap` section, so they stay in sync with the importer.
 */
import type { ReactElement } from 'react';

import { AppHeader, ErrorView, Screen, SkeletonList } from '../components/ui';
import { addableFields } from '../config/bankSchema';
import { BanksEditorView } from './BanksEditorView';
import { BanksListView } from './BanksListView';
import {
  bankSection,
  banksOf,
  type BanksScreenModel,
  presentFields,
  targetsOf,
  useBanksScreenModel,
} from './BanksScreenModel';

interface Props {
  /** Reports drill-down depth (0 = bank list, 1 = editing a bank). */
  onDepthChange?: (depth: number) => void;
}

function SelectedBankRoute({
  model,
  selected,
}: {
  model: BanksScreenModel;
  selected: string;
}): ReactElement {
  const section = model.manifest ? bankSection(model.manifest) : undefined;
  if (!section) {
    return <BanksListRoute model={model} />;
  }

  const banks = banksOf(model.config);
  const bank = banks[selected] ?? {};
  const catalog = section.bankFields ?? [];
  const requirement = model.manifest?.bankRequirements[selected];
  const requiredKeys = new Set<string>(requirement?.required ?? []);
  const present = presentFields(catalog, bank);
  const missing = addableFields(section, requirement, bank);

  return (
    <BanksEditorView
      bankName={model.nameOf(selected)}
      bank={bank}
      presentFields={present}
      missingFields={missing}
      requiredKeys={requiredKeys}
      targetFields={section.targetFields ?? []}
      targets={targetsOf(bank)}
      saving={model.saving}
      saveErrors={model.saveErrors}
      sheetOpen={model.sheetOpen}
      onBack={model.closeSelected}
      onSave={() => {
        void model.save();
      }}
      onFieldChange={(key, value) => {
        model.setBank(selected, { ...bank, [key]: value });
      }}
      onFieldRemove={(key) => {
        model.removeField(selected, bank, key);
      }}
      onTargetsChange={(targets) => {
        model.setBank(selected, { ...bank, targets });
      }}
      onOpenSheet={model.openSheet}
      onCloseSheet={model.closeSheet}
      onAddField={(field) => {
        model.addField(selected, bank, field);
      }}
    />
  );
}

function BanksListRoute({ model }: { model: BanksScreenModel }): ReactElement {
  const banks = banksOf(model.config);
  const configuredIds = Object.keys(banks);
  const catalog = (model.manifest?.banks ?? []).filter((id) => !configuredIds.includes(id));

  return (
    <BanksListView
      banks={banks}
      configuredIds={configuredIds}
      catalog={catalog}
      nameOf={model.nameOf}
      onSelect={model.selectBank}
      onStartAdd={model.startAdd}
      onRemove={model.confirmRemove}
    />
  );
}

function BanksScreenReady({ model }: { model: BanksScreenModel }): ReactElement {
  if (model.selected) {
    return <SelectedBankRoute model={model} selected={model.selected} />;
  }

  return <BanksListRoute model={model} />;
}

/**
 * Renders the banks editor screen.
 * @param props - Callback to return to the home screen.
 * @returns The banks editor element.
 */
export function BanksScreen({ onDepthChange }: Props): ReactElement {
  const model = useBanksScreenModel(onDepthChange);

  if (model.loading) {
    return (
      <Screen header={<AppHeader title="Banks" />}>
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (model.error) {
    return (
      <Screen scroll={false} header={<AppHeader title="Banks" />}>
        <ErrorView message={model.error} onRetry={model.reload} />
      </Screen>
    );
  }

  return <BanksScreenReady model={model} />;
}
