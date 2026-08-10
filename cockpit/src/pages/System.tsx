import { Footer } from "../gasok/components/Footer";
import { ProductShell } from "../gasok/components/ProductShell";
import { SystemMap } from "../gasok/components/SystemMap";
import "../gasok/styles.css";

export default function System() {
  return <ProductShell footer={<Footer />}><main><SystemMap direct /></main></ProductShell>;
}
