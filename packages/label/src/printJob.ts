import { encodeD30, type D30Job, type Rotation } from './encode';
import { renderLabel, type LabelInput } from './render';

export function buildJob(input: LabelInput, rotation?: Rotation): D30Job {
  return encodeD30(renderLabel(input), rotation);
}
