// Lets node --experimental-transform-types import the engine's extension-less TS specifiers.
import { register } from 'node:module';
register('./ts-loader.mjs', import.meta.url);
