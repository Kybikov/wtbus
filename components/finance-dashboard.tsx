"use client"
import * as React from "react"
import { AppShell } from "@/components/app-shell"
import { CrewPayrollWorkspace } from "@/components/crew-payroll-workspace"
import { MoneyWorkspace } from "@/components/money-workspace"
import { AccountingWorkspace } from "@/components/accounting-workspace"
import { TripMoneySummary } from "@/components/trip-money-summary"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function FinanceDashboard() {
  const [revision, setRevision] = React.useState(0)
  return (
    <AppShell
      pageTitle="Финансы"
      pageDescription="Кошельки, расходы и передача денег"
      onRefresh={() => setRevision((v) => v + 1)}
    >
      <Tabs defaultValue="money" className="min-w-0">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="money">Касса</TabsTrigger>
          <TabsTrigger value="trips">Результаты рейсов</TabsTrigger>
          <TabsTrigger value="accounting">Зарплата и учёт</TabsTrigger>
        </TabsList>
        <TabsContent value="money" className="min-w-0 pt-4">
          <MoneyWorkspace key={revision} />
        </TabsContent>
        <TabsContent value="trips" className="min-w-0 pt-4">
          <TripMoneySummary key={revision} />
        </TabsContent>
        <TabsContent value="accounting" className="min-w-0 pt-4">
          <CrewPayrollWorkspace key={revision} />
          <AccountingWorkspace refreshKey={revision} payrollOnly />
        </TabsContent>
      </Tabs>
    </AppShell>
  )
}
