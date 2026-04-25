import { useParams } from "react-router-dom";
export default function Editor() {
  const { workId } = useParams();
  return <main className="page">Editor shell · workId={workId} · 待 Plan 3 填实</main>;
}
