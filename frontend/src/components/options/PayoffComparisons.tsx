import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, CardHeader, Input, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import type { OptionLeg, PayoffAlternative, PayoffComparison } from "@/lib/options";

/** Keep named leg sets; all calculations and comparisons come from the server. */
export function PayoffComparisons({ label, alternatives, legs, comparisons, onChange }: {
  label: string;
  alternatives: PayoffAlternative[];
  legs: OptionLeg[];
  comparisons?: PayoffComparison[];
  onChange: (label: string, alternatives: PayoffAlternative[]) => void;
}) {
  const { t } = useTranslation();
  const save = () => {
    let index = 1;
    let name = t("options.comparison.saved", { index });
    while (name === label || alternatives.some((item) => item.label === name)) {
      name = t("options.comparison.saved", { index: ++index });
    }
    onChange(label, [...alternatives, { label: name, legs: legs.map((leg) => ({ ...leg })) }]);
  };
  const percent = (value: number | undefined) => value == null ? "-" : `${(value * 100).toFixed(2)}%`;
  return (
    <Card>
      <CardHeader title={t("options.comparison.title")} description={t("options.comparison.basis")} />
      <CardBody className="space-y-3">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {t("options.comparison.current")}
          <Input className="w-56" value={label} onChange={(event) => onChange(event.target.value, alternatives)} />
          <Button disabled={alternatives.length >= 5 || !legs.length} onClick={save}>{t("options.comparison.save")}</Button>
        </label>
        <ul className="space-y-2">
          {alternatives.map((item, index) => <li key={index} className="flex items-center gap-2">
            <Input className="w-56" aria-label={t("options.comparison.saved", { index: index + 1 })} value={item.label}
              onChange={(event) => onChange(label, alternatives.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry))} />
            <Button variant="ghost" size="sm" onClick={() => onChange(label, alternatives.filter((_, i) => i !== index))}>{t("options.comparison.remove")}</Button>
          </li>)}
        </ul>
        {!!comparisons?.length && <Table>
          <THead><TR>{(["metric", "alternative", "baseline", "difference"] as const).map((key) => <TH key={key}>{t(`options.comparison.${key}`)}</TH>)}</TR></THead>
          <TBody>{comparisons.map((comparison) => comparison.status !== "ok"
            ? <TR key={comparison.left_label}><TD colSpan={4}>{comparison.left_label}: {comparison.reason}</TD></TR>
            : Object.entries(comparison.metrics ?? {}).map(([metric, values]) => <TR key={`${comparison.left_label}-${metric}`}>
              <TD>{t(`options.comparison.${metric as "max_profit_return" | "max_loss_return" | "entry_cost_return"}`)}</TD>
              <TD className="tabular-nums">{comparison.left_label}: {percent(values.left_decimal)}</TD>
              <TD className="tabular-nums">{comparison.right_label}: {percent(values.right_decimal)}</TD>
              <TD className="tabular-nums">{values.relation ? `${t(`options.comparison.${values.relation}`)} · ${values.difference_percentage_points?.toFixed(2)}` : "-"}</TD>
            </TR>))}</TBody>
        </Table>}
      </CardBody>
    </Card>
  );
}
