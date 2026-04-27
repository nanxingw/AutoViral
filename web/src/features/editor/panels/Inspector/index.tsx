import { Tabs, TabList, Tab, TabContent } from "@/ui/Tabs";
import { DesignTab } from "./DesignTab";
import { CopyTab } from "./CopyTab";
import { AITab } from "./AITab";

interface InspectorProps {
  workId: string;
}

export function Inspector({ workId }: InspectorProps) {
  return (
    <div style={{ padding: 12, height: "100%", display: "flex", flexDirection: "column" }}>
      <Tabs defaultValue="design" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <TabList>
          <Tab value="design">Design</Tab>
          <Tab value="copy">Copy</Tab>
          <Tab value="ai">AI</Tab>
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
