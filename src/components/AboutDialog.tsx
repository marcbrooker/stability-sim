import { useState } from 'react';

export function AboutDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="sim-btn sim-btn-sm" onClick={() => setOpen(true)}>
        About
      </button>
      {open && (
        <>
          <div className="about-backdrop" onClick={() => setOpen(false)} />
          <div className="about-dialog">
            <div className="about-header">
              <strong>Stability Sim</strong>
              <button
                className="sim-btn sim-btn-sm"
                onClick={() => setOpen(false)}
                style={{ padding: '1px 6px', background: 'none' }}
              >
                ✕
              </button>
            </div>

            <p>
              An interactive discrete-event simulator for exploring how distributed
              systems fail. Build a topology, inject failures, and watch cascading
              effects unfold in real time.
            </p>

            <p className="about-caveat">
              This is an early experiment — the simulation models are intentionally
              simplified to build intuition, not to replace production load testing.
              Service times are sampled at request arrival rather than varying during
              execution, network latency between components is zero, and load-dependent
              latency uses a configurable curve rather than modeling the underlying
              mechanism (GC, lock contention, etc.). These simplifications mean the
              simulator is good for understanding <em>which</em> feedback loops cause
              metastable failures and <em>why</em> they self-sustain, but its quantitative
              predictions — exact tipping points, recovery times — will be optimistic.
            </p>

            <div className="about-section-title">More to read</div>
            <ul className="about-links">
              <li>
                <a href="https://brooker.co.za/blog/2021/05/24/metastable.html" target="_blank" rel="noopener noreferrer">
                  Metastability and Distributed Systems
                </a>
                {' — '}Marc Brooker
              </li>
              <li>
                <a href="https://sigops.org/s/conferences/hotos/2021/papers/hotos21-s11-bronson.pdf" target="_blank" rel="noopener noreferrer">
                  Metastable Failures in Distributed Systems
                </a>
                {' — '}Bronson, Aghayev, Charapko &amp; Zhu (HotOS 2021)
              </li>
              <li>
                <a href="https://www.usenix.org/conference/osdi22/presentation/huang-lexiang" target="_blank" rel="noopener noreferrer">
                  Metastable Failures in the Wild
                </a>
                {' — '}Huang et al. (OSDI 2022)
              </li>
              <li>
                <a href="https://brooker.co.za/blog/2022/02/28/retries.html" target="_blank" rel="noopener noreferrer">
                  Fixing Retries with Token Buckets and Circuit Breakers
                </a>
                {' — '}Marc Brooker
              </li>
              <li>
                <a href="https://aws.amazon.com/builders-library/avoiding-insurmountable-queue-backlogs/" target="_blank" rel="noopener noreferrer">
                  Avoiding Insurmountable Queue Backlogs
                </a>
                {' — '}AWS Builders Library
              </li>
              <li>
                <a href="https://sre.google/sre-book/addressing-cascading-failures/" target="_blank" rel="noopener noreferrer">
                  Addressing Cascading Failures
                </a>
                {' — '}Google SRE Book
              </li>
            </ul>

            <div className="about-section-title">Contribute</div>
            <p>
              Source code and issues on{' '}
              <a href="https://github.com/marcbrooker/stability-sim/" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>.
            </p>
          </div>
        </>
      )}
    </>
  );
}
