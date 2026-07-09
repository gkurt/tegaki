import React from 'react';
import { Text, Timegroup } from '@editframe/react';

const sceneClass = 'absolute inset-0 overflow-hidden bg-[#080711] text-white';

const OrbitLines = () => (
  <div className="pointer-events-none absolute inset-0 opacity-70">
    <div className="orbit orbit-1" />
    <div className="orbit orbit-2" />
    <div className="orbit orbit-3" />
  </div>
);

const WritingLine = ({ className = '', delay = '0s' }: { className?: string; delay?: string }) => (
  <div className={`writing-line ${className}`} style={{ '--draw-delay': delay } as React.CSSProperties}>
    <svg viewBox="0 0 760 180" aria-hidden="true">
      <path d="M42 112 C120 24 212 24 278 112 S438 200 512 104 S622 20 718 94" />
    </svg>
  </div>
);

const FeatureCard = ({ title, body, index }: { title: string; body: string; index: number }) => (
  <div className="feature-card" style={{ '--card-index': index } as React.CSSProperties}>
    <span>{String(index + 1).padStart(2, '0')}</span>
    <strong>{title}</strong>
    <p>{body}</p>
  </div>
);

export const Video = () => {
  return (
    <Timegroup workbench className="relative h-[1080px] w-[1920px] overflow-hidden bg-[#080711] font-sans" mode="sequence" overlapMs={800}>
      <Timegroup mode="fixed" duration="4s" className={sceneClass}>
        <div className="aurora aurora-a" />
        <div className="aurora aurora-b" />
        <OrbitLines />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-48 text-center">
          <Text split="char" className="eyebrow tracking-[0.55em] text-[#8dd8ff]">
            INTRODUCING
          </Text>
          <Text split="char" className="brand-title mt-10 text-[178px] font-black leading-none tracking-[-0.08em]">
            Tegaki
          </Text>
          <WritingLine className="mt-2 w-[760px]" delay="0.7s" />
          <Text split="word" className="mt-12 max-w-[1120px] text-[54px] font-semibold leading-[1.08] text-[#f5f1ff]">
            Handwriting animations from any font.
          </Text>
        </div>
      </Timegroup>

      <Timegroup mode="fixed" duration="4.5s" className={sceneClass}>
        <div className="grid-bg" />
        <div className="absolute left-24 top-24 w-[760px]">
          <Text split="word" className="section-kicker text-[#ffb7dc]">
            GENERATE
          </Text>
          <Text split="word" className="section-title mt-7 text-[92px] font-black leading-[0.94] tracking-[-0.055em]">
            Turn glyph outlines into motion-ready strokes.
          </Text>
          <Text split="word" className="section-copy mt-9 text-[36px] leading-tight text-[#cbc5e8]">
            Tegaki parses fonts, traces skeletons, estimates stroke width, and packages compact bundles for the web.
          </Text>
        </div>
        <div className="pipeline absolute bottom-24 right-24 top-24 w-[860px] rounded-[54px] border border-white/10 bg-white/[0.055] p-14 shadow-2xl shadow-cyan-500/10 backdrop-blur">
          {['Font', 'Flatten', 'Skeleton', 'Trace', 'Bundle'].map((step, index) => (
            <div className="pipeline-step" style={{ '--step-index': index } as React.CSSProperties} key={step}>
              <span>{step}</span>
            </div>
          ))}
          <WritingLine className="absolute bottom-20 left-16 right-16" delay="1.1s" />
        </div>
      </Timegroup>

      <Timegroup mode="fixed" duration="4.5s" className={sceneClass}>
        <div className="aurora aurora-c" />
        <div className="absolute inset-0 px-24 py-20">
          <Text split="word" className="section-kicker text-[#9ef7c7]">
            RENDER EVERYWHERE
          </Text>
          <div className="mt-14 grid grid-cols-3 gap-8">
            <FeatureCard title="Framework adapters" body="React, Svelte, Vue, Solid, Astro, Web Components, and vanilla JavaScript." index={0} />
            <FeatureCard title="Built for timelines" body="Control playback with time props, CSS variables, and deterministic preview URLs." index={1} />
            <FeatureCard title="International fonts" body="Latin, Hebrew, Arabic, and Japanese bundles ship ready to import." index={2} />
          </div>
          <div className="code-card absolute bottom-24 left-24 right-24 rounded-[44px] border border-white/10 bg-[#05040a]/85 p-10 text-[34px] leading-[1.45] text-[#d7f8ff] shadow-2xl">
            <span className="text-[#8dd8ff]">import</span> {'{ TegakiRenderer }'} <span className="text-[#8dd8ff]">from</span> 'tegaki/react';<br />
            <span className="text-[#ffb7dc]">&lt;TegakiRenderer</span> text="Ship beautiful handwriting" <span className="text-[#ffb7dc]">/&gt;</span>
          </div>
        </div>
      </Timegroup>

      <Timegroup mode="fixed" duration="4s" className={sceneClass}>
        <div className="final-glow" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-48 text-center">
          <Text split="word" className="section-kicker text-[#8dd8ff]">
            FROM FONT TO FLOURISH
          </Text>
          <Text split="char" className="brand-title mt-8 text-[150px] font-black leading-none tracking-[-0.075em]">
            Write the web.
          </Text>
          <WritingLine className="mt-8 w-[920px]" delay="0.8s" />
          <Text split="word" className="mt-16 text-[48px] font-semibold text-[#f5f1ff]">
            Tegaki — animated handwriting for product demos, docs, and creative tools.
          </Text>
        </div>
      </Timegroup>
    </Timegroup>
  );
};
