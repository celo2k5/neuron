import { HomeHero } from "@/components/home/HomeHero";
import { HomeLoop } from "@/components/home/HomeLoop";
import { HomeSpecimens } from "@/components/home/HomeSpecimens";
import { HomeProof } from "@/components/home/HomeProof";

export default function Home() {
  return (
    <>
      <HomeHero />
      <HomeLoop />
      <HomeSpecimens />
      <HomeProof />
    </>
  );
}
