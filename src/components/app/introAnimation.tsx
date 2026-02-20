"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

export default function TabGuideAnimation() {
  type Step = 1 | 2 | 3 | 4;

  const durations: Record<Step, number> = {
    1: 5800,
    2: 5800,
    3: 5800,
    4: 8800,
  };

  const steps: Step[] = [1, 2, 3, 4];

  const pauseBetween = 350;

  const [step, setStep] = useState<Step>(1);

  useEffect(() => {
    async function run() {
      while (true) {
        for (const s of steps) {
          setStep(s);
          await wait(durations[s]);
          await wait(pauseBetween);
        }
      }
    }
    run();
  }, []);

  // ---- CLEAN UPDATED COPY ----

  const TITLES: Record<Step, string> = {
    1: "Send money instantly",
    2: "Split bills, no hassle",
    3: "Let Tab pick who pays",
    4: "Earn while you sleep",
  };

  const SUBTITLES: Record<Step, string> = {
    1: "Pay anyone on Base by username",
    2: "Everyone sees what they owe. No awkward math",
    3: "A fun way to settle the bill",
    4: "Grow your USDC automatically",
  };

  return (
    <div className="flex flex-col items-center justify-center h-[380px] w-full">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.35, ease: [0.42, 0, 0.58, 1] }}
          className="text-white p-3 shadow-lg overflow-hidden w-full bg-white/5 rounded-xl"
        >
          {/* STEP 1 — Send */}
          {step === 1 && (
            <motion.div
              className="flex flex-col gap-1 py-3"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {[
                { name: "rita", pfp: "https://api.dicebear.com/7.x/fun-emoji/svg?seed=rita" },
                { name: "maria", pfp: "https://api.dicebear.com/7.x/fun-emoji/svg?seed=maria" },
              ].map((u, i) => (
                <motion.div
                  key={i}
                  className="relative flex items-center justify-between bg-white/5 px-4 py-3 rounded-lg overflow-hidden"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{
                    opacity: 1,
                    x: 0,
                    transition: { delay: i * 0.18 },
                  }}
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={u.pfp}
                      className="w-10 h-10 rounded-full border border-white/10"
                    />
                    <span className="text-white font-medium">@{u.name}</span>
                  </div>

                  <motion.div
                    initial={{ opacity: 0, x: 4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: 0.5 + i * 0.35,
                      duration: 0.3,
                    }}
                    className="text-green-400 text-sm font-semibold bg-primary/10 px-2 py-1 rounded-md shrink-0"
                  >
                    Sent
                  </motion.div>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* STEP 2 — Split */}
          {step === 2 && (
            <motion.div
              className="flex flex-col items-center gap-4"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex -space-x-3 mt-1">
                {["carlos", "dwr", "vitalik", "kon"].map((name, i) => (
                  <div
                    key={i}
                    className="w-10 h-10 rounded-full bg-white/10 overflow-hidden border-2 border-white/10"
                    style={{ zIndex: 4 - i }}
                  >
                    <img
                      src={`https://api.dicebear.com/7.x/fun-emoji/svg?seed=${name}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>

              <div className="text-3xl text-primary font-semibold">$124.20</div>
              <div className="text-white/50 text-sm">2 of 3 paid</div>
            </motion.div>
          )}

          {/* STEP 3 — Roulette */}
          {step === 3 && (
            <motion.div
              className="flex flex-col items-center gap-4"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex -space-x-3">
                {["lisa", "jules", "alex", "toni", "maria", "julia"].map(
                  (name, i) => (
                    <div
                      key={i}
                      className="w-10 h-10 rounded-full bg-white/10 overflow-hidden border-2 border-white/10"
                      style={{ zIndex: 6 - i }}
                    >
                      <img
                        src={`https://api.dicebear.com/7.x/fun-emoji/svg?seed=${name}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )
                )}
              </div>

              <motion.button
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", duration: 0.35, bounce: 0.25 }}
                className="w-full bg-white/5 text-white text-md font-semibold py-3 rounded-lg cursor-default"
              >
                Roll the Dice
              </motion.button>
            </motion.div>
          )}

          {/* STEP 4 — Yield */}
          {step === 4 && (
            <motion.div
              className="flex flex-col items-center gap-3 py-3 relative overflow-hidden"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="relative w-full flex justify-center h-[60px]">
                {[...Array(4)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute text-yellow-300 text-lg"
                    initial={{
                      opacity: 0,
                      y: -6,
                      x: Math.random() * 60 - 30,
                    }}
                    animate={{
                      opacity: [0, 1, 0],
                      y: [-6, 15, 30],
                    }}
                    transition={{
                      duration: 1.4 + Math.random() * 0.4,
                      repeat: Infinity,
                      repeatDelay: Math.random() * 0.6,
                    }}
                  >
                    💸
                  </motion.div>
                ))}

                <motion.div
                  className="absolute bottom-0 w-[90px] h-[30px] rounded-b-md bg-white/10 border border-white/10 backdrop-blur-sm flex justify-center"
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.35, delay: 0.15 }}
                >
                  <motion.div
                    className="absolute bottom-0 w-full h-full rounded-b-md bg-primary/10"
                    animate={{ opacity: [0, 0.25, 0] }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                    }}
                  />
                </motion.div>
              </div>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Titles / Subtitles */}
      <motion.div
        key={`text-${step}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.25 }}
        className="mt-6 text-center space-y-1"
      >
        <h2 className="text-white text-lg font-semibold">
          {TITLES[step]}
        </h2>
        <p className="text-white/40 text-sm">
          {SUBTITLES[step]}
        </p>
      </motion.div>
    </div>
  );
}

function wait(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
