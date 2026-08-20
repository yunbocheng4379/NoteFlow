import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const featureGrid = readFileSync(resolve(here, '../src/pages/LandingPage/components/FeatureGrid.tsx'), 'utf8')
const landingFooter = readFileSync(resolve(here, '../src/pages/LandingPage/components/LandingFooter.tsx'), 'utf8')

assert.match(featureGrid, /const\s+FEATURES\s*=/, 'FeatureGrid must define FEATURES')
assert.match(landingFooter, /const\s+COLUMNS\s*=/, 'LandingFooter must define COLUMNS')

console.log('Landing page data definitions are present')
