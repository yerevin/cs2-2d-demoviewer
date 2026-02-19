const aliasMap: { [key: string]: string } = {
  // AK variants
  ak47: 'AK',
  'weapon_ak47': 'AK',
  'ak-47': 'AK',

  // M4 variants
  m4a1: 'M4',
  m4a4: 'M4',
  'weapon_m4a1': 'M4',

  // USP / Pistol
  usp: 'USP',
  'usp_silencer': 'USP',
  'weapon_usp': 'USP',

  // Grenades / utility
  flashbang: 'FLASH',
  'weapon_flashbang': 'FLASH',
  smokegrenade: 'SMOKE',
  'weapon_smokegrenade': 'SMOKE',
  smoke: 'SMOKE',
  hegrenade: 'HE',
  'weapon_hegrenade': 'HE',
  molotov: 'MOLO',
  'weapon_molotov': 'MOLO',
  incendiary: 'MOLO',
  'incendiarygrenade': 'MOLO',
  fire: 'FIRE',

  // Misc
  knife: 'KNIFE',
  c4: 'C4',
};

export function normalizeWeapon(raw: string | undefined | null): string {
  if (!raw) return '';
  const r = raw.toLowerCase();
  // Try exact alias map keys
  for (const k of Object.keys(aliasMap)) {
    if (r.includes(k)) return aliasMap[k];
  }

  // Fallback: strip common prefixes and uppercase
  let cleaned = r.replace(/weapon_/g, '').replace(/-/g, '_');
  cleaned = cleaned.split('_')[0] || cleaned;
  return cleaned.toUpperCase();
}

// Map of weapon raw names to asset filenames (without extension)
const weaponAssetMap: { [key: string]: string } = {
  // Rifles
  'ak47': 'ak47',
  'weapon_ak47': 'ak47',
  'm4a1': 'm4a1',
  'weapon_m4a1': 'm4a1',
  'm4a1_silencer': 'm4a1_silencer',
  'weapon_m4a1_silencer': 'm4a1_silencer',
  'm4a4': 'm4a1', // fallback to m4a1
  'galilar': 'galilar',
  'weapon_galilar': 'galilar',
  'aug': 'aug',
  'weapon_aug': 'aug',

  // SMGs
  'mac10': 'mac10',
  'weapon_mac10': 'mac10',
  'mp9': 'mp9',
  'weapon_mp9': 'mp9',
  'mp7': 'mp7',
  'weapon_mp7': 'mp7',
  'ump45': 'mac10', // similar style, fallback
  'weapon_ump45': 'mac10',
  'tec9': 'tec9',
  'weapon_tec9': 'tec9',

  // Sniper
  'awp': 'awp',
  'weapon_awp': 'awp',

  // Pistols
  'usp_silencer': 'usp_silencer',
  'weapon_usp_silencer': 'usp_silencer',
  'usp': 'usp_silencer',
  'weapon_usp': 'usp_silencer',
  'glock': 'glock',
  'weapon_glock': 'glock',
  'deagle': 'deagle',
  'weapon_deagle': 'deagle',
  'p250': 'p250',
  'weapon_p250': 'p250',
  'elite': 'elite',
  'weapon_elite': 'elite',

  // Grenades
  'flashbang': 'flashbang',
  'weapon_flashbang': 'flashbang',
  'smokegrenade': 'smokegrenade',
  'weapon_smokegrenade': 'smokegrenade',
  'hegrenade': 'hegrenade',
  'weapon_hegrenade': 'hegrenade',
  'molotov': 'molotov',
  'weapon_molotov': 'molotov',
  'incendiary': 'molotov',
  'incendiarygrenade': 'molotov',
  'weapon_incendiarygrenade': 'molotov',
  'incgrenade': 'incgrenade',
  'weapon_incgrenade': 'incgrenade',

  // Utility
  'knife': 'knife',
  'weapon_knife': 'knife',
  'c4': 'c4',
  'weapon_c4': 'c4',
};

export function getWeaponAssetPath(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const r = raw.toLowerCase().replace(/weapon_/g, '');
  
  // // Try direct match first
  // if (weaponAssetMap[r]) {
  //   return `/assets/icons/weapons/${weaponAssetMap[r]}.svg`;
  // }
  
  // // Try prefix match
  // for (const key of Object.keys(weaponAssetMap)) {
  //   if (r.includes(key)) {
  //     return `/assets/icons/weapons/${weaponAssetMap[key]}.svg`;
  //   }
  // }
  
  return null;
}

export default normalizeWeapon;
