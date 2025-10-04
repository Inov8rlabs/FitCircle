# FitCircle Product-Market Fit Metrics Framework
**Version 1.0 | Last Updated: October 2, 2025**

## Executive Summary

Product-Market Fit (PMF) is the degree to which FitCircle satisfies strong market demand. This document outlines our comprehensive framework for measuring, monitoring, and achieving PMF through quantitative metrics, qualitative signals, and actionable benchmarks based on industry standards.

## PMF Score Calculation Methodology

### FitCircle PMF Score Formula

```
PMF Score = (0.3 × Retention Score) + (0.25 × Engagement Score) +
            (0.2 × Growth Score) + (0.15 × Satisfaction Score) +
            (0.1 × Economic Score)
```

**Score Interpretation:**
- **0-40:** No PMF - Pivot required
- **41-60:** Weak PMF - Major improvements needed
- **61-75:** Emerging PMF - Optimize and iterate
- **76-85:** Strong PMF - Ready to scale
- **86-100:** Exceptional PMF - Aggressive growth mode

## Leading Indicators

### 1. Activation Metrics

#### Definition
Users who complete the core value experience within first 7 days

#### Measurements
- **Activation Rate:** % of new users who join first challenge
  - Current: Baseline to establish
  - Target: 60%
  - Best-in-class: 75%

- **Time to Activation:** Hours from signup to first challenge join
  - Target: <2 hours
  - Best-in-class: <30 minutes

- **Profile Completion Rate:** % completing full health profile
  - Target: 80%
  - Best-in-class: 90%

#### SQL Query
```sql
SELECT
  DATE_TRUNC('week', u.created_at) as cohort_week,
  COUNT(DISTINCT u.user_id) as new_users,
  COUNT(DISTINCT CASE
    WHEN c.joined_at IS NOT NULL
    AND c.joined_at <= u.created_at + INTERVAL '7 days'
    THEN u.user_id
  END) as activated_users,
  ROUND(100.0 * COUNT(DISTINCT CASE
    WHEN c.joined_at IS NOT NULL
    AND c.joined_at <= u.created_at + INTERVAL '7 days'
    THEN u.user_id
  END) / COUNT(DISTINCT u.user_id), 2) as activation_rate
FROM users u
LEFT JOIN challenge_participants c ON u.user_id = c.user_id
WHERE u.created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY 1
ORDER BY 1 DESC;
```

### 2. Engagement Metrics

#### Daily Active Users (DAU)
- **Current Baseline:** To be established
- **Month 3 Target:** 10,000 DAU
- **Month 6 Target:** 50,000 DAU
- **Month 12 Target:** 200,000 DAU
- **PMF Threshold:** 100,000 DAU

#### Monthly Active Users (MAU)
- **Current Baseline:** To be established
- **Month 3 Target:** 30,000 MAU
- **Month 6 Target:** 150,000 MAU
- **Month 12 Target:** 600,000 MAU
- **PMF Threshold:** 300,000 MAU

#### DAU/MAU Ratio (Stickiness)
- **Target:** 33% (users active 10 days/month)
- **Best-in-class:** 50%
- **Minimum viable:** 25%

#### Session Metrics
- **Sessions per DAU:** Target 2.5+
- **Average Session Duration:** Target 8+ minutes
- **Sessions per Week:** Target 12+
- **Features per Session:** Target 4+

#### SQL Query for Engagement
```sql
WITH daily_active AS (
  SELECT
    DATE(activity_timestamp) as activity_date,
    COUNT(DISTINCT user_id) as dau
  FROM user_activities
  WHERE activity_timestamp >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY 1
),
monthly_active AS (
  SELECT
    DATE_TRUNC('month', activity_timestamp) as activity_month,
    COUNT(DISTINCT user_id) as mau
  FROM user_activities
  WHERE activity_timestamp >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY 1
)
SELECT
  d.activity_date,
  d.dau,
  m.mau,
  ROUND(100.0 * d.dau / NULLIF(m.mau, 0), 2) as stickiness_ratio
FROM daily_active d
JOIN monthly_active m
  ON DATE_TRUNC('month', d.activity_date) = m.activity_month
ORDER BY d.activity_date DESC;
```

### 3. Retention Metrics

#### Cohort Retention Targets

| Day | Target | Best-in-Class | Minimum Viable |
|-----|---------|--------------|----------------|
| D1 | 40% | 50% | 25% |
| D3 | 30% | 40% | 20% |
| D7 | 25% | 35% | 15% |
| D14 | 20% | 30% | 12% |
| D30 | 15% | 25% | 10% |
| D60 | 12% | 20% | 8% |
| D90 | 10% | 18% | 6% |

#### Challenge-Specific Retention
- **Challenge Completion Rate:** Target 65%
- **Re-engagement Rate:** Target 45% join 2nd challenge
- **Power User Rate:** Target 20% join 3+ challenges/month

#### SQL Query for Cohort Retention
```sql
WITH cohort_users AS (
  SELECT
    user_id,
    DATE_TRUNC('week', created_at) as cohort_week,
    created_at
  FROM users
  WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
),
user_activities AS (
  SELECT DISTINCT
    user_id,
    DATE(activity_timestamp) as activity_date
  FROM user_activities
)
SELECT
  c.cohort_week,
  COUNT(DISTINCT c.user_id) as cohort_size,
  COUNT(DISTINCT CASE
    WHEN a.activity_date = DATE(c.created_at) + INTERVAL '1 day'
    THEN c.user_id
  END) as d1_retained,
  COUNT(DISTINCT CASE
    WHEN a.activity_date = DATE(c.created_at) + INTERVAL '7 days'
    THEN c.user_id
  END) as d7_retained,
  COUNT(DISTINCT CASE
    WHEN a.activity_date = DATE(c.created_at) + INTERVAL '30 days'
    THEN c.user_id
  END) as d30_retained,
  ROUND(100.0 * COUNT(DISTINCT CASE
    WHEN a.activity_date = DATE(c.created_at) + INTERVAL '1 day'
    THEN c.user_id
  END) / COUNT(DISTINCT c.user_id), 2) as d1_retention_rate,
  ROUND(100.0 * COUNT(DISTINCT CASE
    WHEN a.activity_date = DATE(c.created_at) + INTERVAL '7 days'
    THEN c.user_id
  END) / COUNT(DISTINCT c.user_id), 2) as d7_retention_rate,
  ROUND(100.0 * COUNT(DISTINCT CASE
    WHEN a.activity_date = DATE(c.created_at) + INTERVAL '30 days'
    THEN c.user_id
  END) / COUNT(DISTINCT c.user_id), 2) as d30_retention_rate
FROM cohort_users c
LEFT JOIN user_activities a ON c.user_id = a.user_id
GROUP BY c.cohort_week
ORDER BY c.cohort_week DESC;
```

### 4. Growth Metrics

#### Viral Coefficient (K-factor)
- **Formula:** K = i × c
  - i = number of invites sent per user
  - c = conversion rate of invites
- **Current Target:** 0.6
- **6-Month Target:** 0.8
- **PMF Threshold:** 1.0+
- **Measurement Frequency:** Weekly

#### Organic Growth Rate
- **% of new users from organic channels**
  - Target: 30%
  - Best-in-class: 50%
- **Word-of-mouth referrals**
  - Target: 20% of new users

#### Viral Cycle Time
- **Time from user signup to successful referral**
  - Target: <7 days
  - Best-in-class: <3 days

## Lagging Indicators

### 1. Net Promoter Score (NPS)

#### Measurement Methodology
- Survey triggered after first challenge completion
- Quarterly surveys for all active users
- Segmented by user cohort and engagement level

#### Targets
- **Month 3:** NPS 30+
- **Month 6:** NPS 40+
- **Month 12:** NPS 50+
- **PMF Threshold:** NPS 40+
- **Best-in-class:** NPS 70+

#### NPS Calculation
```sql
WITH nps_responses AS (
  SELECT
    user_id,
    score,
    CASE
      WHEN score >= 9 THEN 'Promoter'
      WHEN score >= 7 THEN 'Passive'
      ELSE 'Detractor'
    END as category,
    response_date
  FROM nps_surveys
  WHERE response_date >= CURRENT_DATE - INTERVAL '30 days'
)
SELECT
  COUNT(CASE WHEN category = 'Promoter' THEN 1 END) as promoters,
  COUNT(CASE WHEN category = 'Passive' THEN 1 END) as passives,
  COUNT(CASE WHEN category = 'Detractor' THEN 1 END) as detractors,
  COUNT(*) as total_responses,
  ROUND(100.0 * (
    COUNT(CASE WHEN category = 'Promoter' THEN 1 END) -
    COUNT(CASE WHEN category = 'Detractor' THEN 1 END)
  ) / COUNT(*), 1) as nps_score
FROM nps_responses;
```

### 2. Customer Satisfaction (CSAT)

#### Measurement Points
- Post-onboarding (Day 1)
- Post-first challenge (Day 30)
- Quarterly for active users

#### Targets
- **Overall CSAT:** 4.5/5.0
- **Feature-specific CSAT:** 4.0/5.0 minimum
- **Support CSAT:** 4.7/5.0

### 3. Churn Rate

#### Monthly Churn Targets
- **Month 3:** <10%
- **Month 6:** <7%
- **Month 12:** <5%
- **PMF Threshold:** <5%
- **Best-in-class:** <3%

#### Churn Analysis SQL
```sql
WITH monthly_cohorts AS (
  SELECT
    user_id,
    DATE_TRUNC('month', created_at) as cohort_month,
    DATE_TRUNC('month', churned_at) as churn_month
  FROM users
  WHERE created_at >= CURRENT_DATE - INTERVAL '12 months'
)
SELECT
  cohort_month,
  COUNT(DISTINCT user_id) as cohort_size,
  COUNT(DISTINCT CASE
    WHEN churn_month = cohort_month + INTERVAL '1 month'
    THEN user_id
  END) as m1_churned,
  ROUND(100.0 * COUNT(DISTINCT CASE
    WHEN churn_month = cohort_month + INTERVAL '1 month'
    THEN user_id
  END) / COUNT(DISTINCT user_id), 2) as m1_churn_rate
FROM monthly_cohorts
GROUP BY cohort_month
ORDER BY cohort_month DESC;
```

### 4. Revenue Metrics

#### Lifetime Value (LTV)
- **30-day LTV Target:** $25
- **90-day LTV Target:** $60
- **180-day LTV Target:** $85
- **PMF Threshold:** LTV > 3×CAC

#### Customer Acquisition Cost (CAC)
- **Blended CAC Target:** $25
- **Paid CAC Target:** $35
- **Organic CAC Target:** $5

#### LTV/CAC Ratio
- **Month 3 Target:** 2.0
- **Month 6 Target:** 2.5
- **Month 12 Target:** 3.4
- **PMF Threshold:** 3.0+
- **Best-in-class:** 5.0+

#### Average Revenue Per User (ARPU)
- **Free User ARPU:** $2.50 (ads)
- **Paid User ARPU:** $14.99
- **Blended ARPU Target:** $7.50

## Cohort Analysis Framework

### Cohort Segmentation

#### By Acquisition Channel
- Paid Social (Facebook, Instagram, TikTok)
- Organic Search
- Referral Program
- Influencer Partnerships
- Direct/Brand

#### By User Behavior
- Power Users (daily active)
- Regular Users (3-5x per week)
- Casual Users (1-2x per week)
- At-Risk Users (inactive 7+ days)
- Churned Users (inactive 30+ days)

#### By Demographics
- Age Groups (18-24, 25-34, 35-44, 45+)
- Geographic Region
- Device Type (iOS, Android, Web)
- Subscription Tier (Free, Pro, Team)

### Cohort Performance Metrics

```sql
WITH cohort_metrics AS (
  SELECT
    DATE_TRUNC('month', u.created_at) as cohort_month,
    u.acquisition_channel,
    COUNT(DISTINCT u.user_id) as users,
    AVG(CASE WHEN p.user_id IS NOT NULL THEN 1 ELSE 0 END) as conversion_rate,
    AVG(s.session_count) as avg_sessions,
    AVG(r.revenue) as avg_revenue
  FROM users u
  LEFT JOIN paid_users p ON u.user_id = p.user_id
  LEFT JOIN session_stats s ON u.user_id = s.user_id
  LEFT JOIN revenue r ON u.user_id = r.user_id
  WHERE u.created_at >= CURRENT_DATE - INTERVAL '6 months'
  GROUP BY 1, 2
)
SELECT
  cohort_month,
  acquisition_channel,
  users,
  ROUND(conversion_rate * 100, 2) as conversion_pct,
  ROUND(avg_sessions, 1) as avg_sessions_per_user,
  ROUND(avg_revenue, 2) as arpu
FROM cohort_metrics
ORDER BY cohort_month DESC, users DESC;
```

## Benchmarks Based on Industry Standards

### Fitness App Benchmarks 2024

| Metric | FitCircle Target | Industry Average | Top Performers |
|--------|------------------|------------------|----------------|
| D1 Retention | 40% | 25% | 50% |
| D7 Retention | 25% | 15% | 35% |
| D30 Retention | 15% | 10% | 25% |
| DAU/MAU | 33% | 20% | 50% |
| NPS | 50 | 30 | 70 |
| Paid Conversion | 15% | 5% | 25% |
| Monthly Churn | 5% | 10% | 3% |
| LTV/CAC | 3.4 | 1.8 | 5.0 |
| Viral Coefficient | 0.6 | 0.3 | 1.2 |

### Weight Loss Competition App Benchmarks

| Metric | HealthyWage | DietBet | StepBet | FitCircle Target |
|--------|-------------|---------|---------|------------------|
| Success Rate | 77% | 96% | N/A | 85% |
| Avg Payout | $1,175 | $50-60 | $10-30 | $100-500 |
| User Base | 188K paid out | 750K total | N/A | 100K Year 1 |
| Total Payouts | $67M | $62M | N/A | $10M Year 2 |

## PMF Score Components

### 1. Retention Score (30% weight)
```
Score = (D30_Retention / 0.25) × 100
- If D30 = 15%, Score = 60
- If D30 = 20%, Score = 80
- If D30 = 25%, Score = 100
```

### 2. Engagement Score (25% weight)
```
Score = (DAU/MAU / 0.5) × 100
- If DAU/MAU = 25%, Score = 50
- If DAU/MAU = 33%, Score = 66
- If DAU/MAU = 50%, Score = 100
```

### 3. Growth Score (20% weight)
```
Score = (K-factor / 1.0) × 100
- If K = 0.5, Score = 50
- If K = 0.8, Score = 80
- If K = 1.2, Score = 120 (capped at 100)
```

### 4. Satisfaction Score (15% weight)
```
Score = (NPS + 100) / 2
- If NPS = 0, Score = 50
- If NPS = 50, Score = 75
- If NPS = 100, Score = 100
```

### 5. Economic Score (10% weight)
```
Score = (LTV/CAC / 5) × 100
- If LTV/CAC = 2, Score = 40
- If LTV/CAC = 3, Score = 60
- If LTV/CAC = 5, Score = 100
```

## Target Metrics for Series A Readiness

### Must-Have Metrics
- **MAU:** 300,000+
- **MRR:** $250,000+
- **LTV/CAC:** 3.0+
- **D30 Retention:** 20%+
- **NPS:** 40+
- **Gross Margin:** 70%+
- **Growth Rate:** 20% MoM

### Nice-to-Have Metrics
- **Viral Coefficient:** 1.0+
- **Organic Growth:** 40%+
- **DAU/MAU:** 40%+
- **ARPU Growth:** 10% QoQ
- **Market Share:** 2%+

## Monitoring & Reporting Framework

### Real-Time Dashboards

#### Executive Dashboard
- PMF Score (updated daily)
- Key metrics vs targets
- Cohort performance
- Revenue metrics

#### Product Dashboard
- Feature adoption rates
- User journey funnels
- A/B test results
- Bug/crash reports

#### Growth Dashboard
- Acquisition channels
- Viral metrics
- Retention cohorts
- CAC by channel

### Reporting Cadence

#### Daily
- DAU, new users, revenue
- Challenge participation
- Critical bugs/issues

#### Weekly
- Retention cohorts
- Engagement metrics
- Viral coefficient
- NPS responses

#### Monthly
- Full PMF score calculation
- Cohort analysis
- LTV/CAC analysis
- Competitive benchmarking

#### Quarterly
- Strategic review
- Market analysis
- Investor updates
- Goal setting

## Action Plans Based on PMF Score

### Score 0-40: No PMF
**Immediate Actions:**
- Conduct 50+ user interviews
- Pivot core value proposition
- Test 3-5 new concepts
- Reduce burn rate

### Score 41-60: Weak PMF
**Focus Areas:**
- Improve onboarding (reduce friction)
- Enhance core features
- Fix retention leaks
- Increase engagement loops

### Score 61-75: Emerging PMF
**Growth Actions:**
- Scale marketing cautiously
- A/B test monetization
- Build viral features
- Expand team slowly

### Score 76-85: Strong PMF
**Scale Actions:**
- Aggressive user acquisition
- International expansion
- Platform features
- Series A fundraising

### Score 86-100: Exceptional PMF
**Domination Mode:**
- Maximum growth investment
- M&A opportunities
- Category expansion
- Market leadership

## SQL Dashboard Queries

### Master PMF Query
```sql
WITH pmf_metrics AS (
  SELECT
    -- Retention Score
    (SELECT AVG(CASE WHEN days_since_signup = 30 THEN retention_rate END)
     FROM retention_cohorts) as d30_retention,

    -- Engagement Score
    (SELECT COUNT(DISTINCT user_id) FROM daily_active_users WHERE date = CURRENT_DATE) /
    NULLIF((SELECT COUNT(DISTINCT user_id) FROM monthly_active_users WHERE month = DATE_TRUNC('month', CURRENT_DATE)), 0) as dau_mau,

    -- Growth Score
    (SELECT AVG(invites_sent * conversion_rate) FROM referral_metrics
     WHERE date >= CURRENT_DATE - INTERVAL '7 days') as k_factor,

    -- Satisfaction Score
    (SELECT (COUNT(CASE WHEN score >= 9 THEN 1 END) -
             COUNT(CASE WHEN score <= 6 THEN 1 END)) * 100.0 / COUNT(*)
     FROM nps_surveys WHERE date >= CURRENT_DATE - INTERVAL '30 days') as nps,

    -- Economic Score
    (SELECT AVG(ltv) / NULLIF(AVG(cac), 0) FROM unit_economics
     WHERE cohort_month >= CURRENT_DATE - INTERVAL '3 months') as ltv_cac_ratio
)
SELECT
  ROUND((d30_retention / 0.25 * 100) * 0.30 +
        (dau_mau / 0.5 * 100) * 0.25 +
        (k_factor / 1.0 * 100) * 0.20 +
        ((nps + 100) / 2) * 0.15 +
        (ltv_cac_ratio / 5 * 100) * 0.10, 1) as pmf_score,
  d30_retention,
  dau_mau,
  k_factor,
  nps,
  ltv_cac_ratio
FROM pmf_metrics;
```

## Conclusion

This PMF metrics framework provides FitCircle with a comprehensive, data-driven approach to measuring and achieving product-market fit. By focusing on these metrics and maintaining discipline around our targets, we can systematically progress from initial launch to Series A readiness while building a sustainable, high-growth business.

The key to success is not just measuring these metrics but acting on them quickly, iterating based on data, and maintaining a relentless focus on user satisfaction and retention.