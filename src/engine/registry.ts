import type { EffectModule } from './protocol'
import barsWave from '../effects/barsWave'
import lfoFilter from '../effects/lfoFilter'
import keyboardADSR from '../effects/keyboardADSR/index';


const modules: EffectModule[] = [barsWave, lfoFilter, keyboardADSR];


export function listEffects() {
    return modules.map((m) => m.info)
}


export function getEffect(id: string) {
    return modules.find((m) => m.info.id === id)
}