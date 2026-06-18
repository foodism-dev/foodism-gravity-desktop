/** 从 .env 注入的产品调试开关。true 时恢复被产品化隐藏的高级入口。 */
declare const __FOODISM_DEV_FEATURES__: boolean

export const foodismDevFeaturesEnabled = typeof __FOODISM_DEV_FEATURES__ !== 'undefined'
  ? __FOODISM_DEV_FEATURES__
  : false
