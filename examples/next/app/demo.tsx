'use client';

import { useState } from 'react';
import { TegakiRenderer } from 'tegaki';
import bundle from 'tegaki/fonts/caveat';

export function ScrubDemo() {
  const [time, setTime] = useState(0);

  return (
    <>
      <input type="range" min={0} max={8} step={0.01} value={time} onChange={(e) => setTime(Number(e.target.value))} />
      <TegakiRenderer font={bundle} time={time} style={{ fontSize: '48px' }}>
        Scrub me!
      </TegakiRenderer>
    </>
  );
}
