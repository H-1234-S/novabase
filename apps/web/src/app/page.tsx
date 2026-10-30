import Link from 'next/link';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Cloud,
  Code2,
  Database,
  Fingerprint,
  FolderOpen,
  Globe2,
  LockKeyhole,
  Radio,
  ShieldCheck,
  Terminal,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const features = [
  {
    icon: Database,
    title: 'Postgres Database',
    description: 'A full Postgres database for every project, with a visual table editor and powerful SQL workspace.',
    tag: 'DATABASE',
  },
  {
    icon: Fingerprint,
    title: 'Authentication',
    description: 'Add secure sign-up and sign-in in minutes. Manage users, providers, and sessions from one place.',
    tag: 'AUTH',
  },
  {
    icon: FolderOpen,
    title: 'Storage',
    description: 'Store, organize, and serve user files with simple APIs and project-level access controls.',
    tag: 'STORAGE',
  },
  {
    icon: Radio,
    title: 'Realtime',
    description: 'Listen to database changes and build collaborative experiences with live subscriptions.',
    tag: 'REALTIME',
  },
];

const codeLines = [
  { number: '01', content: <><span className="text-[#7928ca]">import</span> {'{ createClient }'} <span className="text-[#7928ca]">from</span> <span className="text-[#0070f3]">&apos;@novabase/client&apos;</span></> },
  { number: '02', content: '' },
  { number: '03', content: <><span className="text-[#7928ca]">const</span> novabase = <span className="text-[#0070f3]">createClient</span>({'{'}</> },
  { number: '04', content: <>  url: process.env.<span className="text-[#0070f3]">NOVABASE_URL</span>,</> },
  { number: '05', content: <>  key: process.env.<span className="text-[#0070f3]">NOVABASE_KEY</span></> },
  { number: '06', content: '{})' },
  { number: '07', content: '' },
  { number: '08', content: <><span className="text-[#7928ca]">const</span> {'{ data }'} = <span className="text-[#7928ca]">await</span> novabase</> },
  { number: '09', content: <>  .<span className="text-[#0070f3]">from</span>(<span className="text-[#0070f3]">&apos;projects&apos;</span>)</> },
  { number: '10', content: <>  .<span className="text-[#0070f3]">select</span>(<span className="text-[#0070f3]">&apos;*&apos;</span>)</> },
];

function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-[17px] font-semibold tracking-[-0.5px] text-[#171717]">
      <span className="grid size-7 place-items-center rounded-md bg-[#171717] text-white">
        <Cloud className="size-4" strokeWidth={2.2} />
      </span>
      novabase
    </span>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#fafafa] text-[#171717]">
      <header className="relative z-20 border-b border-[#ebebeb] bg-[#fafafa]/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <Link href="/" aria-label="NovaBase home"><Wordmark /></Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
            <a className="rounded-full px-3 py-2 text-sm text-[#4d4d4d] transition-colors hover:text-[#171717]" href="#features">Features</a>
            <a className="rounded-full px-3 py-2 text-sm text-[#4d4d4d] transition-colors hover:text-[#171717]" href="#developers">Developers</a>
            <a className="rounded-full px-3 py-2 text-sm text-[#4d4d4d] transition-colors hover:text-[#171717]" href="#infrastructure">Infrastructure</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="rounded-md"><Link href="/login">Log in</Link></Button>
            <Button asChild size="sm" className="rounded-md bg-[#171717] px-3 text-white hover:bg-[#171717]/85"><Link href="/register">Start building</Link></Button>
          </div>
        </div>
      </header>

      <section className="relative border-b border-[#ebebeb]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(ellipse 38% 55% at 12% 8%, rgba(0,124,240,.16), transparent 70%), radial-gradient(ellipse 35% 50% at 86% 18%, rgba(121,40,202,.13), transparent 72%), radial-gradient(ellipse 35% 45% at 72% 85%, rgba(255,0,128,.09), transparent 72%), radial-gradient(ellipse 25% 35% at 24% 90%, rgba(249,203,40,.12), transparent 70%)',
          }}
        />
        <div className="relative mx-auto grid max-w-[1200px] items-center gap-16 px-6 py-24 lg:grid-cols-[1.02fr_.98fr] lg:py-32">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#ebebeb] bg-white/80 px-3 py-1.5 font-mono text-xs text-[#4d4d4d] shadow-[0_1px_1px_rgba(0,0,0,.04)]">
              <span className="size-1.5 rounded-full bg-[#0070f3]" />
              BACKEND AS A SERVICE
            </div>
            <h1 className="max-w-[620px] text-[48px] leading-[1.02] font-semibold tracking-[-2.4px] sm:text-[64px] sm:leading-[1.02] sm:tracking-[-3.2px]">
              Build your product.<br />We&apos;ll handle the backend.
            </h1>
            <p className="mt-6 max-w-[520px] text-base leading-7 text-[#4d4d4d] sm:text-lg">
              Everything you need to ship modern applications. A production-ready database, authentication, storage, and realtime APIs — all in one platform.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild className="h-11 rounded-full bg-[#171717] px-5 text-base text-white hover:bg-[#171717]/85">
                <Link href="/register">Start your project <ArrowRight /></Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-full border-[#ebebeb] bg-white px-5 text-base hover:bg-[#f2f2f2]">
                <a href="#developers">Explore the platform</a>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#8f8f8f]">
              <span className="inline-flex items-center gap-1.5"><Check className="size-3.5" /> Free to get started</span>
              <span className="inline-flex items-center gap-1.5"><Check className="size-3.5" /> No credit card required</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[520px]">
            <div className="absolute -inset-8 -z-10 rounded-full bg-white/40 blur-2xl" />
            <div className="overflow-hidden rounded-xl border border-[#ebebeb] bg-white shadow-[0_2px_2px_rgba(0,0,0,.02),0_16px_40px_-16px_rgba(0,0,0,.14)]">
              <div className="flex h-11 items-center justify-between border-b border-[#ebebeb] px-4">
                <div className="flex gap-1.5"><span className="size-2.5 rounded-full bg-[#ebebeb]" /><span className="size-2.5 rounded-full bg-[#ebebeb]" /><span className="size-2.5 rounded-full bg-[#ebebeb]" /></div>
                <span className="font-mono text-[11px] text-[#8f8f8f]">quickstart.ts</span>
                <Code2 className="size-3.5 text-[#a1a1a1]" />
              </div>
              <div className="overflow-x-auto py-4 font-mono text-[12px] leading-6">
                {codeLines.map((line) => (
                  <div key={line.number} className="flex min-w-[400px] px-4">
                    <span className="w-8 shrink-0 select-none text-[#c5c5c5]">{line.number}</span>
                    <code className="text-[#4d4d4d]">{line.content}</code>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 border-t border-[#ebebeb] bg-[#fafafa] px-4 py-3 text-xs text-[#4d4d4d]">
                <span className="grid size-5 place-items-center rounded-full bg-[#d3e5ff] text-[#0070f3]"><Check className="size-3" /></span>
                Connected to your NovaBase project
              </div>
            </div>
            <div className="absolute -right-5 -bottom-6 hidden items-center gap-3 rounded-lg border border-[#ebebeb] bg-white px-4 py-3 shadow-[0_8px_16px_-4px_rgba(0,0,0,.08)] sm:flex">
              <span className="grid size-8 place-items-center rounded-md bg-[#f2f2f2]"><Zap className="size-4" /></span>
              <div><p className="text-xs font-medium">API ready</p><p className="mt-0.5 font-mono text-[10px] text-[#8f8f8f]">42ms response</p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#ebebeb] px-6 py-8">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-6 md:flex-row">
          <p className="font-mono text-[11px] tracking-wide text-[#8f8f8f]">ONE BACKEND. EVERY FRAMEWORK.</p>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm font-medium text-[#8f8f8f] sm:gap-x-12">
            <span>Next.js</span><span>React</span><span>Node.js</span><span>Svelte</span><span>Vue</span>
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-16 px-6 py-24 sm:py-32">
        <div className="mx-auto max-w-[1200px]">
          <div className="max-w-[620px]">
            <p className="font-mono text-xs font-medium text-[#8f8f8f]">/ THE COMPLETE BACKEND</p>
            <h2 className="mt-4 text-[32px] leading-10 font-semibold tracking-[-1.28px] sm:text-[40px] sm:leading-[1.15] sm:tracking-[-1.6px]">From first commit to global scale.</h2>
            <p className="mt-4 text-base leading-6 text-[#4d4d4d]">Stop stitching together services. NovaBase gives your application a cohesive backend that works from day one.</p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {features.map(({ icon: Icon, title, description, tag }) => (
              <article key={title} className="group rounded-xl border border-[#ebebeb] bg-white p-6 transition-shadow hover:shadow-[0_2px_2px_rgba(0,0,0,.02),0_8px_16px_-4px_rgba(0,0,0,.06)] sm:p-8">
                <div className="flex items-start justify-between">
                  <span className="grid size-10 place-items-center rounded-lg border border-[#ebebeb] bg-[#fafafa]"><Icon className="size-5" strokeWidth={1.7} /></span>
                  <span className="font-mono text-[10px] text-[#a1a1a1]">{tag}</span>
                </div>
                <h3 className="mt-8 text-xl font-semibold tracking-[-0.4px]">{title}</h3>
                <p className="mt-2 max-w-[440px] text-sm leading-6 text-[#4d4d4d]">{description}</p>
                <a href="#developers" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-[#171717]">Learn more <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="developers" className="scroll-mt-16 border-y border-[#ebebeb] bg-white px-6 py-24 sm:py-32">
        <div className="mx-auto grid max-w-[1200px] gap-16 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="font-mono text-xs font-medium text-[#8f8f8f]">/ DEVELOPER FIRST</p>
            <h2 className="mt-4 text-[32px] leading-10 font-semibold tracking-[-1.28px]">Simple APIs.<br />Powerful possibilities.</h2>
            <p className="mt-5 max-w-[480px] text-base leading-7 text-[#4d4d4d]">Use the tools you already know. Our type-safe client and predictable APIs keep you focused on your product, not your infrastructure.</p>
            <div className="mt-8 space-y-5">
              {[
                ['Instant APIs', 'Your database is immediately available through auto-generated APIs.'],
                ['Built-in security', 'Project keys and access controls keep every request protected.'],
                ['Local to production', 'A consistent development experience at every stage.'],
              ].map(([title, text]) => (
                <div key={title} className="flex gap-3"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-[#ebebeb]"><Check className="size-3" /></span><div><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-sm leading-5 text-[#8f8f8f]">{text}</p></div></div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-[#ebebeb] bg-[#fafafa] p-4 sm:p-6">
            <div className="rounded-lg border border-[#ebebeb] bg-white p-5 font-mono text-xs leading-7 shadow-[0_1px_1px_rgba(0,0,0,.04)]">
              <div className="mb-4 flex items-center gap-2 border-b border-[#ebebeb] pb-3 text-[#8f8f8f]"><Terminal className="size-4" /><span>Terminal</span></div>
              <p><span className="text-[#a1a1a1]">$</span> pnpm add @novabase/client</p>
              <p className="text-[#8f8f8f]">Packages: +24</p>
              <p className="text-[#8f8f8f]">Done in 1.2s</p>
              <p className="mt-3"><span className="text-[#a1a1a1]">$</span> novabase deploy</p>
              <p className="text-[#0070f3]">✓ Production deployment complete</p>
              <p className="mt-3 flex items-center gap-2"><span className="text-[#a1a1a1]">$</span><span className="inline-block h-4 w-1.5 animate-pulse bg-[#171717]" /></p>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[['99.99%', 'Uptime'], ['<50ms', 'API latency'], ['24/7', 'Monitoring']].map(([value, label]) => (
                <div key={label} className="rounded-lg border border-[#ebebeb] bg-white px-3 py-4 text-center"><p className="text-lg font-semibold tracking-[-0.5px]">{value}</p><p className="mt-1 text-[11px] text-[#8f8f8f]">{label}</p></div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="infrastructure" className="scroll-mt-16 px-6 py-24 sm:py-32">
        <div className="mx-auto max-w-[1200px]">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              { icon: Globe2, title: 'Built to scale', text: 'Reliable infrastructure that grows with your application, from prototype to production.' },
              { icon: ShieldCheck, title: 'Secure by default', text: 'Encryption, isolated projects, and fine-grained controls protect your application data.' },
              { icon: LockKeyhole, title: 'Your data, controlled', text: 'Clear access rules and transparent tooling keep you in control of every project.' },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="border-t border-[#171717] pt-6"><Icon className="size-5" strokeWidth={1.6} /><h3 className="mt-5 text-lg font-semibold tracking-[-0.4px]">{title}</h3><p className="mt-2 text-sm leading-6 text-[#4d4d4d]">{text}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[#ebebeb] px-6 py-24 text-center sm:py-28">
        <div className="mx-auto max-w-[760px]">
          <span className="mx-auto grid size-12 place-items-center rounded-xl border border-[#ebebeb] bg-white"><Cloud className="size-6" /></span>
          <h2 className="mt-8 text-[36px] leading-[1.1] font-semibold tracking-[-1.8px] sm:text-[48px] sm:tracking-[-2.4px]">Your next idea starts here.</h2>
          <p className="mx-auto mt-4 max-w-[480px] text-base leading-6 text-[#4d4d4d]">Create a project in seconds and build something people will love.</p>
          <Button asChild className="mt-8 h-11 rounded-full bg-[#171717] px-6 text-base text-white hover:bg-[#171717]/85"><Link href="/register">Start building for free <ArrowRight /></Link></Button>
        </div>
      </section>

      <footer className="border-t border-[#ebebeb] px-6 py-12">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div><Wordmark /><p className="mt-3 text-sm text-[#8f8f8f]">The backend platform for modern builders.</p></div>
          <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-[#4d4d4d]"><a href="#features" className="hover:text-[#171717]">Features</a><a href="#developers" className="hover:text-[#171717]">Developers</a><Link href="/login" className="hover:text-[#171717]">Log in</Link><Link href="/register" className="hover:text-[#171717]">Sign up</Link></div>
        </div>
        <div className="mx-auto mt-10 flex max-w-[1200px] flex-col gap-2 border-t border-[#ebebeb] pt-6 text-xs text-[#8f8f8f] sm:flex-row sm:items-center sm:justify-between"><p>© 2026 NovaBase. All rights reserved.</p><p className="font-mono">DESIGNED FOR BUILDERS.</p></div>
      </footer>
    </main>
  );
}
