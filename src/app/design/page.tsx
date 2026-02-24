"use client";

import { useRef, useState } from "react";
import html2canvas from "html2canvas";

export default function TabitPage() {
  const [text, setText] = useState("Social payments on Base and Farcaster");
  const [error, setError] = useState("");
  const captureRef = useRef<HTMLDivElement>(null);

  const handleDownload = async () => {
    if (!captureRef.current) return;

    // Clone the node
    const clone = captureRef.current.cloneNode(true) as HTMLElement;
    clone.style.position = "absolute";
    clone.style.left = "-10000px";
    clone.style.top = "0";
    document.body.appendChild(clone);

    // Force scale 1 for export
    clone.style.transform = "none";
    clone.style.width = "512px";
    clone.style.height = "512px";

    const canvas = await html2canvas(clone, {
      width: 512,
      height: 512,
      backgroundColor: "#282729",
      useCORS: true,
    });

    document.body.removeChild(clone);

    const link = document.createElement("a");
    link.download = "tab.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const words = e.target.value.trim().split(/\s+/);
    if (words.length > 7) {
      setError("Limit is 7 words.");
    } else {
      setError("");
      setText(e.target.value);
    }
  };

  return (
    <div className="w-full min-h-screen text-white bg-[radial-gradient(#282729_1px,transparent_1px)] [background-size:16px_16px] bg-repeat bg-fixed overflow-x-hidden">
      <div className="content max-w-[1200px] mx-auto flex flex-col lg:grid lg:grid-cols-2 gap-0 lg:gap-0 items-center px-2">
        {/* 🖼️ Image Preview */}

        {/* <div className="flex items-center justify-center overflow-visible rounded-2xl mb-[-100px] sm:mb-[-80px] md:mb-0 min-h-[500px]"> */}
        <div className="flex items-center justify-center overflow-visible min-h-[400px]">
          <div className="w-full overflow-hidden flex justify-center">
            <div className="scale-[0.65] sm:scale-[0.6] md:scale-[0.8] lg:scale-100 origin-top-center">
              <div className="w-[512px] h-[512px] overflow-hidden shadow-xl bg-[#1b1b1b] rounded-2xl">
                <div
                  ref={captureRef}
                  className="relative w-[512px] h-[512px] px-7 py-12 box-border flex flex-col gap-4 rounded-2xl"
                  style={{
                    backgroundColor: "#282729",
                    fontFamily: "sans-serif",
                  }}
                >
                  <div className="flex items-center gap-4">
                    <img
                      src="/newnewnewapp.png"
                      className="w-[94px] h-[94px] mr-1 leading-none"
                      alt="Tab Logo"
                    />
                    <img
                      src="/tab.svg"
                      className="h-[64px] object-contain leading-none"
                      alt="Tab Text"
                    />
                  </div>

                  {/* Text */}
                  <div className="flex flex-col items-start w-full">
                    <p className="font-medium tracking-tight -mt-4 leading-none text-[5.1rem] text-[#75737A] break-words whitespace-pre-wrap text-left w-full">
                      {text}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ✍️ Controls */}
        <div className="flex flex-col justify-center gap-4 max-w-md w-full mx-auto pb-24">
          <p className="ml-2 font-medium">Add text Prompt</p>
          <div className="relative w-full">
            <textarea
              className="placeholder-white/30 w-full p-4 pb-8 bg-input text-white rounded-2xl outline-none resize-none text-base"
              rows={3}
              placeholder="type something epic..."
              value={text}
              onChange={handleChange}
              onFocus={(e) => e.target.select()}
            />
            <span
              className={`absolute bottom-4 left-4 text-sm ${
                error ? "text-red-400" : "text-white/30"
              }`}
            >
              Limit set to 7 words
            </span>
          </div>
          <button
            onClick={handleDownload}
            className="font-medium w-full py-3 rounded-2xl bg-white text-black hover:bg-gray-200 transition"
          >
            Download & Share
          </button>
        </div>
      </div>

      <div className="bg-background text-center fixed bottom-0 inset-x-0 p-2 pb-6 flex justify-around z-1">
        <a
          href={`https://warpcast.com/~/channel/tab`}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-white text-center text-sm opacity-30"
        >
          2025 ©tab tech
        </a>
      </div>
    </div>
  );
}
