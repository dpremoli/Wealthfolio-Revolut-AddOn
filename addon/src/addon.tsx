import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AddonContext, AddonEnableFunction } from "@wealthfolio/addon-sdk";
import { Icons } from "@wealthfolio/ui";
import React from "react";
import CsvImportPage from "./pages/csv-import-page";
import DashboardPage from "./pages/dashboard-page";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes
    },
  },
});

const enable: AddonEnableFunction = (context) => {
  context.api.logger.info("Revolut addon enabling");

  const addedItems: { remove: () => void }[] = [];

  try {
    const sidebarItem = context.sidebar.addItem({
      id: "revolut",
      label: "Revolut Import",
      icon: <Icons.CreditCard size={16} weight="duotone" />,
      route: "/addons/revolut",
      order: 162,
    });
    addedItems.push(sidebarItem);

    const wrap = (Component: React.ComponentType<{ ctx: AddonContext }>) => () => (
      <QueryClientProvider client={queryClient}>
        <Component ctx={context} />
      </QueryClientProvider>
    );

    context.router.add({
      path: "/addons/revolut",
      component: React.lazy(() => Promise.resolve({ default: wrap(DashboardPage) })),
    });

    context.router.add({
      path: "/addons/revolut/import",
      component: React.lazy(() => Promise.resolve({ default: wrap(CsvImportPage) })),
    });

    context.api.logger.info("Revolut addon enabled");
  } catch (error) {
    context.api.logger.error("Failed to enable Revolut addon: " + (error as Error).message);
    throw error;
  }

  context.onDisable(() => {
    context.api.logger.info("Revolut addon disabling");
    addedItems.forEach((item) => {
      try {
        item.remove();
      } catch (err) {
        context.api.logger.error("Error removing item: " + (err as Error).message);
      }
    });
  });
};

export default enable;
