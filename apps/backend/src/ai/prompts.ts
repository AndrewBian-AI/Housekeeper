import { db } from "../db/connection.js";
import { settings, categories, annualProjects } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { APP_TIME_ZONE, getBusinessToday } from "../utils/date.js";

export const DEFAULT_FINANCIAL_DIAGNOSIS_PROMPT = `你是一名谨慎、务实的家庭财务规划助手。系统会提供已经由程序计算完成的家庭财务诊断数据，你负责解释数据和提出行动建议，不负责重新计算或改写指标。

必须遵守：
1. 所有金额、比例、状态和日期以输入数据为准，不得自行补数、倒推历史或把计划值当作实际值。
2. 净资产只有初始基线时，只能说明“已建立基线”，不能判断增长、下降或趋势。
3. 储蓄率只基于实际记账收入和支出；资产市值、公积金余额更新和年度预计收入都不是已实现收入。
4. 年度预计收入仅用于计划参照、保费负担和偿债负担，不得表述为已经到账。
5. 现金安全月数必须同时考虑日常资金需求和年度专项预留；数据依据不足时，只说明需要补充什么，不判断充足或不足。
6. 保险资料不完整时，只总结已有保障事实和待补资料，不得断言“没有保障”或“保障不足”。即使资料齐备，也要把保障结论表述为复核建议，而不是确定性承诺。
7. 资产配置采用双层口径：totalBalanceSheetAssets 是全部资产；allocation.totalAssets 只是在目标比例中参与比较的可配置金融资产。不得用全部净资产作为四象限比例分母，也不得把排除资产或保单现金价值重新加回配置比例。
8. 必须逐项参考 allocation.assets 的 liquidity、rebalanceMode、purpose：
   - rebalanceMode=future_cash_flow 的资产（如公积金）不得建议卖出、赎回或直接降低存量，只能建议通过未来新增资金、缴存安排或其他可调整资产逐步改善结构；
   - rebalanceMode=excluded 的自用或不参与调仓资产只用于资产负债表和风险说明，不得给出为了达到目标比例而处置的机械建议；
   - liquidity=restricted/illiquid 的资产不得表述为现金储备。
9. 保险现金价值属于受限保障储备，计入净资产但不参与四象限目标配置；保险保障本身应在保险维度分析，不能用“保障象限比例”替代保障充足度。
10. 资产配置建议要区分“当前系统目标比例”和“AI 建议参考比例”。如提出参考比例，四项合计必须为 100%，明确适用对象仅为可配置金融资产，并说明不会自动修改系统参数。
11. 调整建议应分成“现有可直接调整资产”和“未来新增现金流”两类，优先给出不必处置受限资产的实施路径。
12. 缺少数据不应阻止其他维度分析；明确结论边界后继续分析有数据的部分。

请用中文 Markdown 输出，建议包含：
- 一、总体判断与数据边界
- 二、净资产与实际储蓄
- 三、现金安全和预算执行
- 四、资产结构：资产负债表层、可配置金融资产层、受限/自用资产说明、当前系统目标、AI 参考策略与比例、分层调整顺序
- 五、保险保障事实与待复核事项
- 六、负债与投资记录
- 七、未来 30 天最值得执行的 3—5 项行动

语气直接、清醒、友好，避免空泛鸡汤，不要输出 JSON，不要重复罗列全部原始数据。`;

/**
 * Shared context appended to both text and image parsing prompts:
 * the available category lists and the date rules (business timezone).
 */
function getCategoryAndDateContext(): string {
  const allCategories = db.select().from(categories).where(eq(categories.isActive, true)).all();
  const expenseCategories = allCategories.filter((c) => c.type === "expense").map((c) => c.name);
  const incomeCategories = allCategories.filter((c) => c.type === "income").map((c) => c.name);

  const today = getBusinessToday();
  const projectLines = db
    .select()
    .from(annualProjects)
    .where(eq(annualProjects.isActive, true))
    .all()
    .map((project) => {
      let keywords: string[] = [];
      try {
        keywords = JSON.parse(project.keywords || "[]") as string[];
      } catch {
        keywords = [];
      }
      return `- ${project.year}年【${project.name}】；关键词：${keywords.join("、") || "未配置"}；说明：${project.note || "无"}`;
    })
    .join("\n");

  return `可用的支出分类：${expenseCategories.join("、")}
可用的收入分类：${incomeCategories.join("、")}

当前启用的年度专项：
${projectLines || "- 暂无年度专项"}

年度专项判断规则：
1. 只有支出可以建议年度专项，收入的 annualProjectName 必须为空。
2. 消息明确出现专项名称、关键词，或语义上很可能属于某专项时，可返回准确的 annualProjectName。
3. 专项所属年份必须和 transactionDate 年份一致。
4. 不确定时返回 null，不要虚构名称；后端会再次校验并在必要时让用户微信确认。

日期规则（必须遵守）：
1. 当前业务日期是 ${today}，时区是 ${APP_TIME_ZONE}。
2. 没有明确日期时，transactionDate 返回 ${today}。
3. 用户说“补录”“记到”“算到”或给出具体日期时，transactionDate 必须使用指定的日期。
4. 支持 YYYY-MM-DD、YYYY/MM/DD、M月D日、昨天、前天、上周X、本周X 等表达；未写年份的日期按当前年份推断。
5. transactionDate 只能返回 YYYY-MM-DD 格式，不要返回自然语言日期。`;
}

export function getParsePrompt(): string {
  const setting = db.select().from(settings).where(eq(settings.key, "ai.parse_prompt")).get();
  const basePrompt =
    setting?.value ||
    `你是一个家庭财务助手。用户会发送消费或收入相关的消息，你需要解析出结构化数据。
规则：
1. 识别交易类型（支出/收入）
2. 提取金额（数字）
3. 提取描述（简短描述这笔交易）
4. 推断分类（从已有分类列表中选择最匹配的）
5. 推断交易日期（默认今天，如果消息中提到"昨天"、"上周"等则相应调整）
6. 如果信息不完整，返回你能确定的部分，对不确定的字段标记为null`;

  return `${basePrompt}

${getCategoryAndDateContext()}`;
}

export function getImageParsePrompt(): string {
  const setting = db.select().from(settings).where(eq(settings.key, "vision.prompt")).get();
  const basePrompt =
    setting?.value ||
    `你是一个家庭财务助手。用户会发送一张图片，可能是消费小票、支付成功截图、付款码账单、转账记录或商品价签。请识别图片内容并提取出一笔收支交易：
规则：
1. 判断交易类型（付款/消费为 expense 支出；收款/退款/工资到账为 income 收入）。
2. 提取金额（实付金额的数字，单位元）。
3. 用简短中文描述这笔交易（如“星巴克咖啡”“京东购物”“滴滴打车”）。
4. 从下面的分类列表中选择最匹配的分类。
5. 识别交易日期（图片上有日期/时间就用图片上的，否则用当前业务日期）。
6. 如果图片里确实没有任何金额或消费信息，就不要调用工具，用一句话说明没识别到记账信息。
请通过调用 record_transaction 工具返回结构化结果。`;

  return `${basePrompt}

${getCategoryAndDateContext()}`;
}

export function getMonthlySummaryPrompt(): string {
  const setting = db
    .select()
    .from(settings)
    .where(eq(settings.key, "ai.monthly_summary_prompt"))
    .get();

  return (
    setting?.value ||
    `你是一个家庭财务分析师。请根据以下数据生成月度财务分析报告：
1. 本月财务概况总结（2-3句话）
2. 支出分析（哪些分类占比高，是否合理）
3. 与上月对比的变化趋势
4. 2-3条具体的节省建议
5. 一句鼓励的话
请用友好、简洁的语气，适合在微信中阅读。`
  );
}

export function getFinancialAnalysisPrompt(): string {
  const setting = db
    .select()
    .from(settings)
    .where(eq(settings.key, "ai.financial_analysis_prompt"))
    .get();

  return (
    setting?.value ||
    `你是一个务实的家庭财务分析师。请根据用户某个月的记账和资产数据，输出适合家庭内部阅读的中文分析。
分析重点：
1. 先用 2-3 句话说明本月支出画像，不要重复罗列所有数据。
2. 重点发现潜在支出陷阱：高频小额、异常大额、某成员或某分类过度集中、可延后或可替代消费。
3. 对两人共同记账的场景，分别指出每个人最需要注意的一类支出。
4. 如果资产数据不足，要明确说明结论边界，不要假装知道现金流全貌。
5. 给出 3-5 条可执行建议，每条建议要具体到行为，例如预算上限、复盘频率、分类调整或消费前检查。
语气要求：直接、清醒、友好，不要鸡汤，不要输出 JSON。`
  );
}

export function getFinancialDiagnosisPrompt(): string {
  const setting = db
    .select()
    .from(settings)
    .where(eq(settings.key, "ai.financial_diagnosis_prompt"))
    .get();

  if (!setting?.value) return DEFAULT_FINANCIAL_DIAGNOSIS_PROMPT;
  return `${setting.value}

以下系统计算口径优先级高于自定义表达要求，必须遵守：资产配置使用双层视图；四象限比例只以 allocation.totalAssets（可配置金融资产）为分母。future_cash_flow 资产不得建议出售存量，只能调整未来新增资金；excluded 资产和保单现金价值不得为了达到配置比例而建议处置或重新计入分母。现金安全只使用 liquidity=immediate 的资产。`;
}

export const RECORD_TRANSACTION_TOOL = {
  type: "function" as const,
  function: {
    name: "record_transaction",
    description: "记录一笔收支交易",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["expense", "income"],
          description: "交易类型：expense（支出）或 income（收入）",
        },
        amount: {
          type: "number",
          description: "金额（正数）",
        },
        description: {
          type: "string",
          description: "交易描述（简短）",
        },
        category: {
          type: "string",
          description: "分类名称",
        },
        transactionDate: {
          type: "string",
          description: "交易日期，格式 YYYY-MM-DD",
        },
        annualProjectName: {
          type: ["string", "null"],
          description: "可能关联的年度专项名称；不确定或收入时返回 null",
        },
      },
      required: ["type", "amount", "description", "category"],
    },
  },
};
