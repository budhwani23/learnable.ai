import { useState } from "react";
import { Activity, ClipboardList, Hourglass, LayoutDashboard, Users } from "lucide-react";
import Header from "@/components/Header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { adminApi } from "@/lib/admin";
import OverviewTab from "@/components/admin/OverviewTab";
import UsersTab from "@/components/admin/UsersTab";
import WaitlistTab from "@/components/admin/WaitlistTab";
import { AuditTab, UsageTab } from "@/components/admin/UsageAuditTabs";
import { useAdminData } from "@/components/admin/common";

/**
 * In-app admin panel (admins only; every /api/admin call is also checked on the server).
 * Overview stats, user management, waitlist approval, usage per resource and the audit log.
 */
const Admin = () => {
  const [tab, setTab] = useState("overview");
  // Waitlist count for the tab badge; refreshed after approvals.
  const { data: waiting, reload: reloadWaiting } = useAdminData(() => adminApi.waitlist({ page_size: 1 }), []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Admin</h1>
          <p className="text-sm text-muted-foreground">Manage users, the launch waitlist and credits.</p>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 h-auto flex-wrap justify-start">
            <TabsTrigger value="overview" className="gap-1.5"><LayoutDashboard className="h-4 w-4" />Overview</TabsTrigger>
            <TabsTrigger value="users" className="gap-1.5"><Users className="h-4 w-4" />Users</TabsTrigger>
            <TabsTrigger value="waitlist" className="gap-1.5" data-testid="waitlist-tab">
              <Hourglass className="h-4 w-4" />Waitlist
              {!!waiting?.total && (
                <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{waiting.total}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="usage" className="gap-1.5"><Activity className="h-4 w-4" />Usage</TabsTrigger>
            <TabsTrigger value="audit" className="gap-1.5"><ClipboardList className="h-4 w-4" />Audit log</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><OverviewTab onOpenWaitlist={() => setTab("waitlist")} /></TabsContent>
          <TabsContent value="users"><UsersTab /></TabsContent>
          <TabsContent value="waitlist"><WaitlistTab onChanged={reloadWaiting} /></TabsContent>
          <TabsContent value="usage"><UsageTab /></TabsContent>
          <TabsContent value="audit"><AuditTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Admin;
