import { describe, expect, it } from 'vitest';
import { sectionVariant } from './sectionVariant';

const BASE = ['I', 'V', 'vi', 'IV'];

describe('sectionVariant', () => {
  it('leaves verse/intro unchanged - the reference reading of the loop', () => {
    expect(sectionVariant(BASE, 'verse')).toEqual(BASE);
    expect(sectionVariant(BASE, 'intro')).toEqual(BASE);
  });

  it('rotates the chorus to start later in the same loop', () => {
    expect(sectionVariant(BASE, 'chorus')).toEqual(['V', 'vi', 'IV', 'I']);
  });

  it('resolves the outro toward the top of the loop', () => {
    // rotate by length-1 == rotate back by 1
    expect(sectionVariant(BASE, 'outro')).toEqual(['IV', 'I', 'V', 'vi']);
  });

  it('lands the pre-chorus on the dominant for lift', () => {
    expect(sectionVariant(BASE, 'pre-chorus')).toEqual(['I', 'V', 'vi', 'V']);
  });

  it('borrows a chord for the bridge, differently by mode', () => {
    expect(sectionVariant(BASE, 'bridge', 'major')).toEqual(['I', 'bVI', 'vi', 'IV']);
    expect(sectionVariant(BASE, 'bridge', 'minor')).toEqual(['I', 'VI', 'vi', 'IV']);
  });

  it('strips breakdown/drop to a tonic-dominant skeleton', () => {
    expect(sectionVariant(BASE, 'breakdown')).toEqual(['I', 'IV']);
    expect(sectionVariant(BASE, 'drop')).toEqual(['I', 'IV']);
  });

  it('never mutates the input array', () => {
    const copy = [...BASE];
    sectionVariant(BASE, 'chorus');
    sectionVariant(BASE, 'bridge');
    expect(BASE).toEqual(copy);
  });

  it('handles an empty or single-chord progression without throwing', () => {
    expect(sectionVariant([], 'chorus')).toEqual([]);
    expect(sectionVariant(['I'], 'bridge')).toEqual(['I']);
    expect(sectionVariant(['I'], 'chorus')).toEqual(['I']);
  });
});
