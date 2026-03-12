// Shared type definitions (JSDoc for IDE support without TypeScript)

/**
 * @typedef {Object} Stock
 * @property {string} ticker
 * @property {string} company_name
 * @property {string} sector
 * @property {string} industry
 * @property {number} market_cap
 */

/**
 * @typedef {'classical' | 'soft_network' | 'hard_network' | 'platform'} NetworkRegime
 */

/**
 * @typedef {'core' | 'asymmetric'} PortfolioTier
 */

/**
 * @typedef {'buy' | 'sell' | 'trim'} TransactionAction
 */

/**
 * @typedef {Object} AttractorScores
 * @property {number} revenue_durability_score
 * @property {number} competitive_reinforcement_score
 * @property {number} industry_structure_score
 * @property {number} demand_feedback_score
 * @property {number} adaptation_capacity_score
 * @property {number} attractor_stability_score
 * @property {NetworkRegime} network_regime
 * @property {string[]} red_flags
 * @property {string} reasoning
 */
