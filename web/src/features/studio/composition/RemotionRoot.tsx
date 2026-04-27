import { Composition, registerRoot } from "remotion";
import { Scene } from "./Scene";
import type { Composition as CompositionData } from "../types";

const Root: React.FC = () => (
  <Composition
    id="main"
    component={Scene as any}
    durationInFrames={1}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{ comp: null as unknown as CompositionData }}
  />
);
registerRoot(Root);
