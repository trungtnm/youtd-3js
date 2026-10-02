// Ported tower behaviors from all elements, keyed by YouTD 2 script name.
// Each element lives in its own file under ./ports so batches can be ported in parallel.

import { PORTS as nature } from './ports/nature.js';
import { PORTS as fire } from './ports/fire.js';
import { PORTS as ice } from './ports/ice.js';
import { PORTS as storm } from './ports/storm.js';
import { PORTS as iron } from './ports/iron.js';
import { PORTS as astral } from './ports/astral.js';
import { PORTS as darkness } from './ports/darkness.js';

export const TOWER_PORTS = { ...nature, ...fire, ...ice, ...storm, ...iron, ...astral, ...darkness };
