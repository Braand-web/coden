import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

type ShiningTextProps = {
  text: string;
  className?: string;
};

export function ShiningText({ text, className = "" }: ShiningTextProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.h1
      className={`bg-[linear-gradient(110deg,#404040,35%,#fff,50%,#404040,75%,#404040)] bg-[length:200%_100%] bg-clip-text text-base font-regular text-transparent ${className}`}
      initial={{ backgroundPosition: "200% 0" }}
      animate={{ backgroundPosition: reduceMotion ? "0% 0" : "-200% 0" }}
      transition={{
        repeat: reduceMotion ? 0 : Infinity,
        duration: 2,
        ease: "linear",
      }}
      style={{
        margin: 0,
        backgroundImage:
          "linear-gradient(110deg,#404040 0%,#404040 35%,#fff 50%,#404040 75%,#404040 100%)",
        backgroundSize: "200% 100%",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        fontSize: "inherit",
        fontWeight: 400,
        lineHeight: "inherit",
      }}
    >
      {text}
    </motion.h1>
  );
}
