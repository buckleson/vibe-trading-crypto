import { Link } from "react-router";
import { ArrowRight, Bot, BarChart3, LineChart, MessagesSquare, ShieldCheck, SearchCode, MessageSquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Page, PageHeader } from "@/components/ui";

export function Home() {
  const { t } = useTranslation();

  const features = [
    { icon: Bot, title: t("about.featureResearch", { defaultValue: "Research agent" }), desc: t("about.featureResearchDesc", { defaultValue: "Describe a strategy in plain language and let the agent write and refine it." }) },
    { icon: BarChart3, title: t("about.featureBacktest", { defaultValue: "Backtesting" }), desc: t("about.featureBacktestDesc", { defaultValue: "Test ideas on crypto, stocks, futures and more with built-in data sources." }) },
    { icon: LineChart, title: t("about.featurePaper", { defaultValue: "Paper trading" }), desc: t("about.featurePaperDesc", { defaultValue: "Run a strategy forward with simulated funds and track profit and loss." }) },
    { icon: MessagesSquare, title: t("about.featureClaude", { defaultValue: "Claude assistant" }), desc: t("about.featureClaudeDesc", { defaultValue: "Chat with Claude in the side panel, or connect it from your terminal." }) },
  ];

  const steps = [
    { icon: MessageSquarePlus, text: t("about.stepDescribe", { defaultValue: "Describe the strategy you want to test." }) },
    { icon: SearchCode, text: t("about.stepResearch", { defaultValue: "The agent researches, writes code and runs a backtest." }) },
    { icon: LineChart, text: t("about.stepPaper", { defaultValue: "Review the results, then run the strategy forward on paper." }) },
    { icon: ShieldCheck, text: t("about.stepLive", { defaultValue: "Connect a broker or exchange when you are ready to go live." }) },
  ];

  return (
    <Page width="narrow">
      <PageHeader
        title={t("about.title", { defaultValue: "Vibe Crypto" })}
        description={t("about.summary", { defaultValue: "A local workspace to research, backtest and paper trade crypto, stocks and other markets, with Claude built in." })}
        actions={
          <Link to="/">
            <Button variant="primary" tabIndex={-1}>
              {t("about.start", { defaultValue: "Start researching" })}
              <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {features.map(({ icon: Icon, title, desc }) => (
          <Card key={title}>
            <CardBody className="space-y-1 p-5">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                <h2 className="text-sm font-semibold">{title}</h2>
              </div>
              <p className="text-[13px] text-muted-foreground">{desc}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <section aria-labelledby="about-how" className="space-y-3">
        <h2 id="about-how" className="text-base font-semibold">{t("about.how", { defaultValue: "How it works" })}</h2>
        <ul className="space-y-2">
          {steps.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-2.5 text-sm">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}
