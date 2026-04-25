import { useParams } from "react-router-dom";
export default function Studio() {
  const { workId } = useParams();
  return <main className="page">Studio shell · workId={workId} · 待 Plan 2 填实</main>;
}
