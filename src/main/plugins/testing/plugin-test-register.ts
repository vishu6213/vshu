/** `node --import vshu-test-register.mjs`: installs the plugin test hooks shipped beside it. */
import { register } from 'node:module'

register('./vshu-test-hooks.mjs', import.meta.url)
