import React from "react";

import Image from "next/image";
import SplashImage from "../../../public/newnewnewapp.png";

const FRAME_SPLASH_IMAGE_SIZE = 88;

const Loading = () => {
  return (
    <div className="inset-0 absolute w-full items-center justify-center flex flex-col flex-grow h-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <Image
        src={SplashImage.src}
        alt="cover"
        className="animate-pulse"
        width={FRAME_SPLASH_IMAGE_SIZE}
        height={FRAME_SPLASH_IMAGE_SIZE}
        style={{ marginTop: `-${FRAME_SPLASH_IMAGE_SIZE}px` }}
      />
    </div>
  );
};

export { Loading };
