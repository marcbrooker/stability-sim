import { useState } from 'react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';

const READING_LIST = [
  {
    href: 'https://brooker.co.za/blog/2021/05/24/metastable.html',
    title: 'Metastability and Distributed Systems',
    author: 'Marc Brooker',
  },
  {
    href: 'https://sigops.org/s/conferences/hotos/2021/papers/hotos21-s11-bronson.pdf',
    title: 'Metastable Failures in Distributed Systems',
    author: 'Bronson, Aghayev, Charapko & Zhu (HotOS 2021)',
  },
  {
    href: 'https://www.usenix.org/conference/osdi22/presentation/huang-lexiang',
    title: 'Metastable Failures in the Wild',
    author: 'Huang et al. (OSDI 2022)',
  },
  {
    href: 'https://brooker.co.za/blog/2022/02/28/retries.html',
    title: 'Fixing Retries with Token Buckets and Circuit Breakers',
    author: 'Marc Brooker',
  },
  {
    href: 'https://aws.amazon.com/builders-library/avoiding-insurmountable-queue-backlogs/',
    title: 'Avoiding Insurmountable Queue Backlogs',
    author: 'AWS Builders Library',
  },
  {
    href: 'https://sre.google/sre-book/addressing-cascading-failures/',
    title: 'Addressing Cascading Failures',
    author: 'Google SRE Book',
  },
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-4 mb-1.5">
      {children}
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
    >
      {children}
    </a>
  );
}

export function AboutDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          About
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Stability Sim</DialogTitle>
          <DialogDescription>
            An interactive discrete-event simulator for exploring how distributed systems fail. Build
            a topology, inject failures, and watch cascading effects unfold in real time.
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground italic leading-relaxed">
          This is an early experiment — the simulation models are intentionally simplified to build
          intuition, not to replace production load testing. Service times are sampled at request
          arrival rather than varying during execution, network latency between components is zero,
          and load-dependent latency uses a configurable curve rather than modeling the underlying
          mechanism (GC, lock contention, etc.). These simplifications mean the simulator is good
          for understanding <em>which</em> feedback loops cause metastable failures and{' '}
          <em>why</em> they self-sustain, but its quantitative predictions — exact tipping points,
          recovery times — will be optimistic.
        </p>

        <div>
          <SectionTitle>Demo</SectionTitle>
          <p className="text-sm">
            <ExternalLink href="https://www.youtube.com/watch?v=ymud-sjJgnQ">
              Watch the video walkthrough
            </ExternalLink>
          </p>

          <SectionTitle>More to read</SectionTitle>
          <ul className="space-y-1 text-sm">
            {READING_LIST.map((entry) => (
              <li key={entry.href}>
                <ExternalLink href={entry.href}>{entry.title}</ExternalLink>
                <span className="text-muted-foreground"> — {entry.author}</span>
              </li>
            ))}
          </ul>

          <SectionTitle>Contribute</SectionTitle>
          <p className="text-sm">
            Source code and issues on{' '}
            <ExternalLink href="https://github.com/marcbrooker/stability-sim/">GitHub</ExternalLink>
            .
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
