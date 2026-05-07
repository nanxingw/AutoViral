import { Tabs, TabList, Tab, TabContent } from "@/ui/Tabs";
import { DesignTab } from "./DesignTab";
import { CopyTab } from "./CopyTab";
import { AITab } from "./AITab";
import { useT } from "@/i18n/useT";

interface InspectorProps {
  workId: string;
}

export function Inspector({ workId }: InspectorProps) {
  const t = useT();
  return (
    <div style={{ padding: 12, height: "100%", display: "flex", flexDirection: "column" }}>
      <Tabs defaultValue="design" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <TabList>
          <Tab value="design">{t("editor.inspectorTabs.design")}</Tab>
          <Tab value="copy">{t("editor.inspectorTabs.copy")}</Tab>
          <Tab value="ai">{t("editor.inspectorTabs.ai")}</Tab>
        </TabList>
        <TabContent value="design" style={{ flex: 1, overflowY: "auto", paddingTop: 12 }}>
          <DesignTab />
        </TabContent>
        <TabContent value="copy" style={{ flex: 1, overflowY: "auto", paddingTop: 12 }}>
          <CopyTab workId={workId} />
        </TabContent>
        <TabContent value="ai" style={{ flex: 1, overflowY: "auto", paddingTop: 12 }}>
          <AITab workId={workId} />
        </TabContent>
      </Tabs>
    </div>
  );
}
