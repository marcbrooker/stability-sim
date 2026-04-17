import { describe, it, expect } from 'vitest';
import { migrate, CURRENT_VERSION } from './migrate';

describe('migrate', () => {
  it('passes through a current-version scenario unchanged', () => {
    const input = { schemaVersion: CURRENT_VERSION, architecture: {}, simulationConfig: {} };
    const result = migrate(input);
    expect(result.schemaVersion).toBe(CURRENT_VERSION);
    expect(result.architecture).toEqual({});
  });

  it('treats missing schemaVersion as version 1', () => {
    const input = { architecture: {}, simulationConfig: {} };
    const result = migrate(input);
    expect(result.schemaVersion).toBe(CURRENT_VERSION);
  });

  it('rejects null', () => {
    expect(() => migrate(null)).toThrow('Expected a JSON object');
  });

  it('rejects arrays', () => {
    expect(() => migrate([])).toThrow('Expected a JSON object');
  });

  it('rejects non-integer schemaVersion', () => {
    expect(() => migrate({ schemaVersion: 1.5 })).toThrow('Invalid schemaVersion');
  });

  it('rejects negative schemaVersion', () => {
    expect(() => migrate({ schemaVersion: -1 })).toThrow('Invalid schemaVersion');
  });

  it('rejects zero schemaVersion', () => {
    expect(() => migrate({ schemaVersion: 0 })).toThrow('Invalid schemaVersion');
  });

  it('rejects string schemaVersion', () => {
    expect(() => migrate({ schemaVersion: 'one' })).toThrow('Invalid schemaVersion');
  });

  it('rejects a version newer than CURRENT_VERSION', () => {
    expect(() => migrate({ schemaVersion: CURRENT_VERSION + 1 })).toThrow(
      /newer than this build/,
    );
  });

  it('suggests refreshing the page for newer versions', () => {
    expect(() => migrate({ schemaVersion: CURRENT_VERSION + 1 })).toThrow(
      /refreshing the page/,
    );
  });
});
