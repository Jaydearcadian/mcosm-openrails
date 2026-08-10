import { useNavigate } from "react-router-dom";
import { CinematicHero } from "../gasok/components/CinematicHero";
import { Footer } from "../gasok/components/Footer";
import { LifecycleStory } from "../gasok/components/LifecycleStory";
import { ProductShell } from "../gasok/components/ProductShell";
import { SystemMap } from "../gasok/components/SystemMap";
import "../gasok/styles.css";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <ProductShell footer={<Footer />}>
      <main>
        <CinematicHero onViewNetwork={() => navigate("/app")} />
        <LifecycleStory />
        <div id="system"><SystemMap /></div>
      </main>
    </ProductShell>
  );
}
