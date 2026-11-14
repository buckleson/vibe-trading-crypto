import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import {
  paperApi,
  type PaperAccount,
  type PaperOrder,
  type PaperPosition,
  type PaperResult,
} from "@/lib/api";
import {
  Badge, Button, Card, CardBody, CardHeader, Field, Input, Select,
  Table, TBody, TD, TH, THead, TR,
} from "@/components/ui";

const rowGrid = "grid grid-cols-[2fr_1fr_1fr_auto] gap-2";

export function ManualAccounts() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<PaperAccount[]>([]);
  const [selected, setSelected] = useState("");
  const [label, setLabel] = useState("");
  const [market, setMarket] = useState("us");
  const [start, setStart] = useState("today");
  const [cash, setCash] = useState("100000");
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [orders, setOrders] = useState<PaperOrder[]>([]);
  const [mode, setMode] = useState("orders");
  const [strategy, setStrategy] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<PaperResult | null>(null);
  const [history, setHistory] = useState<PaperResult[]>([]);
  const account = accounts.find((a) => a.id === selected);
  const currency =
    account?.currency ?? { cn_a: "CNY", hk: "HKD", us: "USD" }[market];

  useEffect(() => {
    let active = true;
    paperApi
      .list()
      .then((items) => {
        if (active) setAccounts(items);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setHistory([]);
    setResult(null);
    setNotice("");
    setOrders([]);
    setDate("");
    if (selected)
      paperApi
        .history(selected)
        .then((items) => {
          if (active) setHistory(items);
        })
        .catch((e: Error) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [selected]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const created = await paperApi.create({
        label,
        market,
        start,
        account_state: { cash: Number(cash), positions },
      });
      setAccounts((items) => [created, ...items]);
      setSelected(created.id);
      setLabel("");
      setPositions([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function advance(event: FormEvent) {
    event.preventDefault();
    if (!account) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const reply = await paperApi.advance(account.id, {
        expected_revision: account.revision,
        to_date: date,
        ...(mode === "strategy" ? { strategy_path: strategy } : { orders }),
      });
      setAccounts((items) =>
        items.map((a) => (a.id === reply.account.id ? reply.account : a)),
      );
      setResult(reply.result);
      setNotice(t(reply.committed ? "paper.saved" : "paper.notSaved"));
      if (reply.committed) setHistory((items) => [...items, reply.result]);
    } catch (e) {
      setError((e as Error).message);
      // A timed-out request may have committed. Reload before any explicit retry.
      try {
        setAccounts(await paperApi.list());
      } catch {
        /* The original error stays visible. */
      }
    } finally {
      setBusy(false);
    }
  }
  const shown = result ?? account?.last_result;
  const number = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const patch = <T,>(
    set: React.Dispatch<React.SetStateAction<T[]>>,
    i: number,
    change: Partial<T>,
  ) => set((list) => list.map((v, j) => (j === i ? { ...v, ...change } : v)));

  return (
    <div className="space-y-4">
      {error && (
        <Card role="alert" className="border-danger/30 bg-danger/10">
          <CardBody className="text-sm text-danger">{error}</CardBody>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
        <aside>
          <Card>
            <CardBody className="space-y-3">
              <Field label={t("paper.accounts")} htmlFor="paper-account">
                <Select
                  id="paper-account"
                  value={selected}
                  disabled={busy}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">{t("paper.newAccount")}</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} · {a.currency}
                    </option>
                  ))}
                </Select>
              </Field>
              {account && (
                <>
                  <p className="text-[13px] text-muted-foreground">
                    {t("paper.eligible", { date: account.start_on })}
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {number(account.account_state.cash)}{" "}
                    <span className="text-sm font-normal text-muted-foreground">{currency}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("paper.cash")} · {account.last_date ?? t("paper.pending")}
                  </p>
                  {account.account_state.positions.map((p) => (
                    <div key={p.symbol} className="flex justify-between gap-2 text-sm">
                      <span>{p.symbol}</span>
                      <span className="tabular-nums">
                        {number(p.qty)} × {number(p.avg_cost)}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </CardBody>
          </Card>
        </aside>
        <div className="min-w-0 space-y-4">
          {!account ? (
            <Card>
              <form onSubmit={create}>
                <CardHeader title={t("paper.newAccount")} />
                <CardBody className="space-y-4">
                  <Field label={t("paper.label")} htmlFor="paper-label">
                    <Input
                      id="paper-label"
                      required
                      maxLength={80}
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t("paper.market")} htmlFor="paper-market">
                      <Select id="paper-market" value={market} onChange={(e) => setMarket(e.target.value)}>
                        {(["us", "hk", "cn_a"] as const).map((m) => (
                          <option key={m} value={m}>
                            {t(`paper.${m}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t("paper.start")} htmlFor="paper-start">
                      <Select id="paper-start" value={start} onChange={(e) => setStart(e.target.value)}>
                        <option value="today">{t("paper.today")}</option>
                        <option value="next_session">{t("paper.nextSession")}</option>
                      </Select>
                    </Field>
                  </div>
                  <Field label={`${t("paper.cash")} (${currency})`} htmlFor="paper-cash">
                    <Input
                      id="paper-cash"
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={cash}
                      onChange={(e) => setCash(e.target.value)}
                    />
                  </Field>
                  <p className="text-[13px] font-medium">{t("paper.initialPositions")}</p>
                  {positions.map((p, i) => (
                    <div className={rowGrid} key={i}>
                      <Input
                        aria-label={t("paper.symbol")}
                        placeholder={t("paper.symbol")}
                        required
                        value={p.symbol}
                        onChange={(e) => patch(setPositions, i, { symbol: e.target.value })}
                      />
                      <Input
                        aria-label={t("paper.quantity")}
                        type="number"
                        min="0.00000001"
                        step="any"
                        required
                        value={p.qty}
                        onChange={(e) => patch(setPositions, i, { qty: Number(e.target.value) })}
                      />
                      <Input
                        aria-label={t("paper.cost")}
                        type="number"
                        min="0.00000001"
                        step="any"
                        required
                        value={p.avg_cost}
                        onChange={(e) => patch(setPositions, i, { avg_cost: Number(e.target.value) })}
                      />
                      <Button
                        variant="secondary"
                        size="icon"
                        aria-label={t("paper.remove")}
                        onClick={() => setPositions((ps) => ps.filter((_, j) => j !== i))}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => setPositions((ps) => [...ps, { symbol: "", qty: 1, avg_cost: 1 }])}
                    >
                      <Plus size={16} />
                      {t("paper.addPosition")}
                    </Button>
                    <Button type="submit" variant="primary" disabled={busy}>
                      {t(busy ? "paper.working" : "paper.create")}
                    </Button>
                  </div>
                </CardBody>
              </form>
            </Card>
          ) : (
            <Card>
              <form onSubmit={advance}>
                <CardHeader title={t("paper.advance")} description={t("paper.executionNote")} />
                <CardBody className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t("paper.date")} htmlFor="paper-date">
                      <Input
                        id="paper-date"
                        type="date"
                        required
                        min={account.start_on}
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </Field>
                    <Field label={t("paper.mode")} htmlFor="paper-mode">
                      <Select id="paper-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                        <option value="orders">{t("paper.orders")}</option>
                        <option value="strategy">{t("paper.strategy")}</option>
                      </Select>
                    </Field>
                  </div>
                  {mode === "strategy" ? (
                    <Field label={t("paper.strategyPath")} htmlFor="paper-strategy">
                      <Input
                        id="paper-strategy"
                        required
                        value={strategy}
                        onChange={(e) => setStrategy(e.target.value)}
                      />
                    </Field>
                  ) : (
                    <>
                      {orders.map((o, i) => (
                        <div key={i} className={rowGrid}>
                          <Input
                            aria-label={t("paper.symbol")}
                            placeholder={t("paper.symbol")}
                            required
                            value={o.symbol}
                            onChange={(e) => patch(setOrders, i, { symbol: e.target.value })}
                          />
                          <Select
                            aria-label={t("paper.side")}
                            value={o.side}
                            onChange={(e) => patch(setOrders, i, { side: e.target.value as "buy" | "sell" })}
                          >
                            <option value="buy">{t("paper.buy")}</option>
                            <option value="sell">{t("paper.sell")}</option>
                          </Select>
                          <Input
                            aria-label={t("paper.quantity")}
                            type="number"
                            min="0.00000001"
                            step="any"
                            required
                            value={o.qty}
                            onChange={(e) => patch(setOrders, i, { qty: Number(e.target.value) })}
                          />
                          <Button
                            variant="secondary"
                            size="icon"
                            aria-label={t("paper.remove")}
                            onClick={() => setOrders((os) => os.filter((_, j) => j !== i))}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      ))}
                      <div>
                        <Button onClick={() => setOrders((os) => [...os, { symbol: "", side: "buy", qty: 1 }])}>
                          {t("paper.addOrder")}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("paper.emptyOrders")}</p>
                    </>
                  )}
                  <Button type="submit" variant="primary" disabled={busy}>
                    {t(busy ? "paper.working" : "paper.advance")}
                  </Button>
                </CardBody>
              </form>
            </Card>
          )}
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          {shown && (
            <Card>
              <CardHeader
                title={t("paper.result")}
                actions={shown.code ? <Badge tone="danger">{shown.code}</Badge> : undefined}
              />
              <CardBody className="space-y-3">
                {shown.code && (
                  <p role="alert" className="text-sm text-danger">
                    {shown.code}: {shown.message}
                  </p>
                )}
                {shown.data_provenance && (
                  <p className="text-xs text-muted-foreground">
                    {shown.data_provenance.source} · {shown.data_provenance.bars_as_of}
                  </p>
                )}
                {!!shown.fills?.length && (
                  <Table>
                    <THead>
                      <TR>
                        {(["date", "symbol", "side", "quantity", "price", "fee"] as const).map((key) => (
                          <TH key={key} numeric={["quantity", "price", "fee"].includes(key)}>
                            {t(`paper.${key}`)}
                          </TH>
                        ))}
                      </TR>
                    </THead>
                    <TBody>
                      {shown.fills.map((f, i) => (
                        <TR key={i}>
                          <TD>{f.trade_date}</TD>
                          <TD>{f.symbol}</TD>
                          <TD>{t(f.side === "buy" ? "paper.buy" : "paper.sell")}</TD>
                          <TD numeric>{number(f.qty)}</TD>
                          <TD numeric>{number(f.price)}</TD>
                          <TD numeric>{number(f.fee)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
                {shown.rejected_orders?.map((r, i) => (
                  <p key={i} className="text-sm text-danger">
                    {r.symbol}: {r.reason_code}
                  </p>
                ))}
                {shown.warnings?.map((w, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {w}
                  </p>
                ))}
              </CardBody>
            </Card>
          )}
          {!!history.length && (
            <Card>
              <CardHeader title={`${t("paper.history")} (${currency})`} />
              <CardBody className="max-h-64 overflow-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>{t("paper.date")}</TH>
                      <TH numeric>{t("paper.nav")}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {history
                      .flatMap((h) => h.nav_series ?? [])
                      .map((n) => (
                        <TR key={n.date}>
                          <TD>{n.date}</TD>
                          <TD numeric>{number(n.nav)}</TD>
                        </TR>
                      ))}
                  </TBody>
                </Table>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
