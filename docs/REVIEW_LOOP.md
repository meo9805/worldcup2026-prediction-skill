# 赛后复盘与校准流程

这份文档用于把 `skill.md` 从一次性赛前预测，升级成可持续校准的预测助手。

核心原则：

1. 不复盘“说得有没有道理”，只复盘“概率和最稳方向有没有被结果验证”。
2. 不把失败归因给足球偶然性，必须沉淀成下一场可执行修正。
3. 精确比分只作娱乐，不作为主要命中指标。
4. 重点追踪 `safestDirection` 和 `parlaySafety` 是否真的更稳。

## 每场赛前记录

```json
{
  "match": "Spain vs Cape Verde",
  "kickoffBeijing": "2026-06-16 00:00",
  "modelAdjusted": {
    "teamAWin": 64,
    "draw": 26,
    "teamBWin": 10
  },
  "safestDirection": {
    "type": "double_chance",
    "pick": "Spain or Draw",
    "estimatedHitRate": 82
  },
  "parlaySafety": {
    "grade": "B",
    "twoLeg": "helper",
    "threeLeg": "helper",
    "fourLeg": "avoid"
  },
  "passRecommended": false,
  "confidence": "中"
}
```

## 每场赛后记录

```json
{
  "actualResult": "0-0",
  "outcome": "draw",
  "outcomeHit": false,
  "safestDirectionHit": true,
  "brierScore": 0.9672,
  "failureReason": ["draw_underestimated", "favorite_bias", "low_block_miss"],
  "nextAdjustment": "同类小组赛首轮强队胜率下调6点，平局上调5点，直接胜不得给A。"
}
```

## Brier Score 计算

三分类胜平负：

```text
Brier = (pA - oA)^2 + (pD - oD)^2 + (pB - oB)^2
```

其中：

- `pA/pD/pB` 是赛前概率，使用 0-1。
- 实际结果对应项为 1，其余为 0。
- 越低越好。

例：

```text
预测：西班牙胜 0.64，平 0.26，佛得角胜 0.10
实际：平局
Brier = (0.64-0)^2 + (0.26-1)^2 + (0.10-0)^2 = 0.9672
```

## 固定错因分类

| 错因 | 说明 | 下一场修正 |
|---|---|---|
| `draw_underestimated` | 平局概率给低 | 同类场次平局底线上调 |
| `favorite_bias` | 强队名气权重过大 | 热门胜率上限下调 |
| `lineup_miss` | 首发判断错 | 首发未确认时降置信 |
| `injury_miss` | 伤停遗漏 | 缺伤停时 PASS 优先 |
| `market_ignored` | 明显偏离市场且无证据 | 偏离收窄到 8 点内 |
| `low_block_miss` | 低位防守风险低估 | 直接胜不得给 A |
| `weather_travel_miss` | 天气/旅行/场地忽略 | 情境权重上调 |
| `finishing_variance` | 射门质量波动 | 精确比分降权 |
| `goalkeeper_overperformance` | 门将爆种 | 强队大胜叙事降权 |
| `red_card_or_penalty` | 红牌/点球偶发 | 记录但不大幅修正 |
| `data_missing` | 缺关键数据还强判 | 置信度降为低 |

## 升级规则

- 连续 2 场 `draw_underestimated`：后续小组赛首轮平局底线 +4。
- 连续 2 场 `favorite_bias`：热门单胜上限临时降到 72。
- 连续 2 场 A 级方向未命中：暂停给 A，除非数据完整且市场/首发一致。
- 连续 3 场 `safestDirectionHit = true` 且 Brier < 0.55：允许同类方向升一级。

## 每日维护建议

每天赛后更新两处：

1. `docs/review-log/YYYY-MM-DD.jsonl`
2. `skill.md` 第六节「最新情报」

`skill.md` 只写稳定结论，不贴长日志。
