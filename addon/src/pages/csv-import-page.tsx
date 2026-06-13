import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@wealthfolio/ui";
import { parseRevolutCsv } from "../lib/csv-parser";
import {
  isInternalMovement,
  mapTransactionToActivity,
  openingBalanceActivity,
  selectNewActivities,
} from "../lib/mapper";
import type { RevolutTransaction } from "../types";

const ACCOUNT_KEY = "revolut_account_id";

export default function CsvImportPage({ ctx }: { ctx: AddonContext }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [transactions, setTransactions] = useState<RevolutTransaction[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [skipInternal, setSkipInternal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<{ imported: number; duplicates: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: wfAccounts = [], refetch: refetchAccounts } = useQuery({
    queryKey: ["wf_accounts"],
    queryFn: () => ctx.api.accounts.getAll(),
  });

  // Pre-select the account remembered from a previous import, if it still exists.
  useEffect(() => {
    if (accountId || wfAccounts.length === 0) return;
    (async () => {
      const remembered = await ctx.api.secrets.get(ACCOUNT_KEY);
      if (remembered && wfAccounts.some((a) => a.id === remembered)) {
        setAccountId(remembered);
      }
    })();
  }, [wfAccounts, accountId, ctx]);

  // Currency to use for a freshly created account: taken from the loaded CSV.
  const csvCurrency = transactions[0]?.currency || "GBP";

  const filtered = transactions.filter((tx) => !skipInternal || !isInternalMovement(tx));

  async function createRevolutAccount() {
    setIsCreating(true);
    setError(null);
    try {
      const account = await ctx.api.accounts.create({
        name: "Revolut",
        accountType: "CASH",
        currency: csvCurrency,
        isDefault: false,
        isActive: true,
        trackingMode: "TRANSACTIONS",
      });
      await ctx.api.secrets.set(ACCOUNT_KEY, account.id);
      await refetchAccounts();
      setAccountId(account.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsCreating(false);
    }
  }

  async function doImport() {
    if (!accountId || filtered.length === 0) return;
    setIsImporting(true);
    setError(null);
    try {
      await ctx.api.secrets.set(ACCOUNT_KEY, accountId);
      const movements = filtered.flatMap((tx) => mapTransactionToActivity(tx, accountId));
      // Seed the pre-statement opening balance only when importing everything; in
      // spending-only mode (skipInternal) the balance is intentionally partial, so
      // seeding it would be misleading.
      const opening = skipInternal ? null : openingBalanceActivity(filtered, accountId);
      const desired = opening ? [opening, ...movements] : movements;

      // Wealthfolio's importer merges any two activities sharing (account, day, type, amount),
      // ignoring the comment and our id, which silently drops genuinely-distinct same-day
      // transactions. We therefore force every row in and do de-duplication ourselves by
      // reconciling against what's already in the account — so re-imports add nothing while
      // real duplicates are preserved.
      const existing = await ctx.api.activities.getAll(accountId);
      const toImport = selectNewActivities(desired, existing).map((a) => ({
        ...a,
        forceImport: true,
      }));
      let imported = 0;
      if (toImport.length > 0) {
        const r = await ctx.api.activities.import(toImport);
        imported = r.summary.imported;
      }
      setResult({ imported, duplicates: desired.length - toImport.length });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="space-y-6 p-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Import from CSV</h1>
          <p className="text-muted-foreground mt-1">
            Import transactions from a Revolut account statement.
          </p>
        </div>
        <Button variant="outline" onClick={() => ctx.api.navigation.navigate("/addons/revolut")}>
          ← Back
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select File</CardTitle>
          <CardDescription>
            Export from Revolut: Account → ⋯ → Statement → Excel/CSV format
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              Choose CSV file
            </Button>
            <span className="text-sm text-muted-foreground">{fileName ?? "No file selected"}</span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                setResult(null);
                setError(null);
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const text = ev.target?.result as string;
                  setTransactions(parseRevolutCsv(text));
                };
                reader.readAsText(file);
              }}
            />
          </div>
          {transactions.length > 0 && (
            <p className="text-sm text-green-700">Parsed {transactions.length} transactions</p>
          )}
        </CardContent>
      </Card>

      {transactions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Import Options</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1">Target account</label>
              <div className="flex items-center gap-2">
                <select
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Select a Wealthfolio account…</option>
                  {wfAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  onClick={createRevolutAccount}
                  disabled={isCreating}
                  className="shrink-0"
                >
                  {isCreating ? "Creating…" : "+ Revolut account"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Create a dedicated {csvCurrency} cash account, or import into an existing one.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={skipInternal}
                onChange={(e) => setSkipInternal(e.target.checked)}
              />
              Skip transfers, exchanges &amp; top-ups (import card spending only)
            </label>
            <p className="text-xs text-muted-foreground -mt-2">
              Leave unchecked to import everything so the account balance matches Revolut. Tick it
              for a spending-only view (the balance will then reflect outgoings only).
            </p>

            <p className="text-xs text-muted-foreground">
              {filtered.length} transactions to import
              {transactions.length - filtered.length > 0 &&
                ` · ${transactions.length - filtered.length} filtered out`}
            </p>

            <Button onClick={doImport} disabled={!accountId || isImporting || filtered.length === 0}>
              {isImporting ? "Importing…" : `Import ${filtered.length} transactions`}
            </Button>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {result && !isImporting && (
              <div className="flex gap-2">
                <Badge variant="outline">{result.imported} imported</Badge>
                <Badge variant="outline">{result.duplicates} duplicates skipped</Badge>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
