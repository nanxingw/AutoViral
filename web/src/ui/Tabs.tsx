import * as RadixTabs from "@radix-ui/react-tabs";
import type { TabsListProps, TabsTriggerProps } from "@radix-ui/react-tabs";
import styles from "./Tabs.module.css";

export const Tabs = RadixTabs.Root;
export const TabList = (p: TabsListProps) => <RadixTabs.List className={styles.list} {...p} />;
export const Tab = (p: TabsTriggerProps) => <RadixTabs.Trigger className={styles.trigger} {...p} />;
export const TabContent = RadixTabs.Content;
