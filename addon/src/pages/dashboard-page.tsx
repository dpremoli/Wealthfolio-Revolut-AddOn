import type { AddonContext } from "@wealthfolio/addon-sdk";
import { Button, Card, CardContent, EmptyPlaceholder, Icons } from "@wealthfolio/ui";
import { PageShell } from "../components/page-shell";

export default function DashboardPage({ ctx }: { ctx: AddonContext }) {
  const openImport = () => ctx.api.navigation.navigate("/addons/revolut/import");

  return (
    <PageShell
      iconName="CreditCard"
      heading="Revolut"
      description="Import your Revolut statement into Wealthfolio for the spending module."
      actions={
        <Button size="lg" onClick={openImport}>
          <Icons.Import size={16} className="mr-1" weight="duotone" />
          Import CSV
        </Button>
      }
    >
      <Card>
        <CardContent className="py-10">
          <EmptyPlaceholder
            icon={
              <div className="rounded-full bg-muted p-4">
                <Icons.CreditCard size={28} weight="duotone" />
              </div>
            }
            title="Import a Revolut statement"
            description="Revolut has no free personal API, so transactions are imported from a CSV statement export. Each currency in the file imports into its own cash account so every balance matches Revolut; card spending flows into the spending module, while transfers and exchanges stay in the balance but are excluded from spending."
          >
            <div className="mt-4">
              <Button onClick={openImport}>
                <Icons.Import size={16} className="mr-1" weight="bold" />
                Import CSV
              </Button>
            </div>
          </EmptyPlaceholder>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6 text-sm text-muted-foreground">
          <p className="text-foreground font-medium">How to export from Revolut</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Open the Revolut app and tap your account.</li>
            <li>
              Tap <span className="text-foreground">⋯ → Statement</span>.
            </li>
            <li>
              Choose <span className="text-foreground">Excel/CSV</span>, pick a date range, and
              generate it.
            </li>
            <li>Open this page, choose the downloaded CSV, and import.</li>
          </ol>
        </CardContent>
      </Card>
    </PageShell>
  );
}
