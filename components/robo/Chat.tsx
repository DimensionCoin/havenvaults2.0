"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Bot,
  User,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Eye,
  Target,
  RefreshCw,
  Coins,
  TrendingUp,
  Shield,
  Zap,
} from "lucide-react";

// ⚠️ THIS IS A PLACEHOLDER COMPONENT WITH FAKE RESPONSES FOR VISUALS ONLY
// All AI responses are hardcoded for demonstration purposes

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  actions?: ActionItem[];
}

interface ActionItem {
  id: string;
  type: "buy" | "sell" | "swap";
  description: string;
  amount: string;
  reason: string;
  checked: boolean;
}

type ServiceType = "overview" | "personalized" | "rebalance" | null;

type FlowStep =
  | "question_1"
  | "question_2"
  | "question_3"
  | "question_4"
  | "analyzing"
  | "results"
  | "chat";

const FAKE_DELAY = 1500;

const SERVICES = [
  {
    id: "overview" as ServiceType,
    title: "Portfolio Overview",
    description: "Get AI analysis of your current holdings and risk exposure",
    icon: Eye,
    cost: "Free 1x/month",
    costTone: "text-primary",
  },
  {
    id: "personalized" as ServiceType,
    title: "Personalized Plan",
    description: "Build a custom investment strategy based on your goals",
    icon: Target,
    cost: "3 credits",
    costTone: "text-amber-500 dark:text-amber-300",
  },
  {
    id: "rebalance" as ServiceType,
    title: "Rebalance Portfolio",
    description: "Get specific buy/sell actions to optimize your allocation",
    icon: RefreshCw,
    cost: "2 credits",
    costTone: "text-amber-500 dark:text-amber-300",
  },
];

const SERVICE_FLOWS: Record<
  Exclude<ServiceType, null>,
  {
    questions: { message: string; options: string[] }[];
    analyzing: string;
    results: { message: string; actions?: ActionItem[] };
  }
> = {
  overview: {
    questions: [
      {
        message:
          "Let's review your portfolio! First, what's your main concern right now?",
        options: [
          "🎯 Am I diversified enough?",
          "📉 Is my risk too high?",
          "💰 Am I missing opportunities?",
          "🔍 Just a general checkup",
        ],
      },
      {
        message: "How long have you been holding your current positions?",
        options: [
          "📅 Less than a month",
          "📆 1-6 months",
          "🗓️ 6-12 months",
          "📊 Over a year",
        ],
      },
    ],
    analyzing: "Analyzing your portfolio composition and risk metrics...",
    results: {
      message: `## Portfolio Overview

**Overall Health Score: 7.2/10**

### Current Allocation
• **SOL**: 60% ($426) — ⚠️ High concentration
• **USDC**: 25% ($178) — ✅ Good stable base
• **ETH**: 15% ($107) — ✅ Solid L1 exposure

### Risk Assessment
Your portfolio is **moderately risky** due to high SOL concentration. A 30% SOL drop would impact 18% of your total value.

### Opportunities
• Consider adding DeFi exposure for yield
• Your stable allocation could earn 8-12% APY in vaults

⚠️ *This is a fake response for visuals only*`,
    },
  },
  personalized: {
    questions: [
      {
        message:
          "Let's build your personalized plan! What's your primary investment goal?",
        options: [
          "💰 Build long-term wealth",
          "🏠 Save for a major purchase",
          "📈 Generate passive income",
          "🚀 Aggressive growth",
        ],
      },
      {
        message: "How would you react if your portfolio dropped 30% in a week?",
        options: [
          "😰 Sell everything immediately",
          "😟 Sell some to reduce risk",
          "😐 Hold and wait it out",
          "🤑 Buy more at the discount",
        ],
      },
      {
        message: "How much are you planning to invest monthly?",
        options: [
          "💵 Under $100",
          "💰 $100 - $500",
          "💎 $500 - $2,000",
          "🏦 Over $2,000",
        ],
      },
      {
        message: "What's your investment timeline?",
        options: [
          "📅 Less than 1 year",
          "📆 1-3 years",
          "🗓️ 3-5 years",
          "🏔️ 5+ years (long term)",
        ],
      },
    ],
    analyzing:
      "Building your personalized investment strategy based on your profile...",
    results: {
      message: `## Your Personalized Investment Plan

Based on your **moderate-aggressive** risk profile and **long-term** horizon:

### Recommended Allocation
| Asset Type | Target | Why |
|------------|--------|-----|
| Blue-chip L1s | 40% | SOL, ETH for growth |
| Stablecoins | 25% | Safety + yield earning |
| DeFi Tokens | 20% | Higher risk/reward |
| BTC | 15% | Store of value |

### Monthly Strategy
With your $100-500/month budget:
1. **Week 1-2**: Add to stablecoin yield vault
2. **Week 3-4**: DCA into SOL/ETH

### Next Steps
I've prepared specific actions to align your current portfolio with this plan.

⚠️ *This is a fake response for visuals only*`,
      actions: [
        {
          id: "1",
          type: "buy",
          description: "Start DeFi Bundle position",
          amount: "$150.00",
          reason: "Get diversified DeFi exposure (20% target)",
          checked: true,
        },
        {
          id: "2",
          type: "buy",
          description: "Add BTC to portfolio",
          amount: "$100.00",
          reason: "Missing BTC allocation entirely",
          checked: true,
        },
        {
          id: "3",
          type: "swap",
          description: "Move $50 USDC to Stable Earn",
          amount: "$50.00",
          reason: "Earn 8% APY on idle stables",
          checked: false,
        },
      ],
    },
  },
  rebalance: {
    questions: [
      {
        message:
          "Time to optimize! What's driving your rebalance decision today?",
        options: [
          "📊 Portfolio drifted from targets",
          "🎯 Changing my strategy",
          "💰 Taking some profits",
          "🛡️ Reducing risk exposure",
        ],
      },
      {
        message: "How aggressive should the rebalancing be?",
        options: [
          "🌱 Light touch (small adjustments)",
          "⚖️ Moderate (meaningful changes)",
          "🔄 Full rebalance (hit targets exactly)",
        ],
      },
    ],
    analyzing:
      "Calculating optimal rebalancing moves based on current prices...",
    results: {
      message: `## Rebalance Recommendations

Based on your goal to **reduce risk** with **moderate** changes:

### Current vs Target
| Asset | Current | Target | Action |
|-------|---------|--------|--------|
| SOL | 60% | 40% | 🔴 Reduce |
| USDC | 25% | 30% | 🟢 Increase |
| ETH | 15% | 20% | 🟢 Increase |
| DeFi | 0% | 10% | 🟢 Add |

### Impact
• Risk score: **7.2 → 5.8** (lower is safer)
• Diversification: **Poor → Good**
• Yield potential: **+$12/month** from stables

Select the actions below to execute:

⚠️ *This is a fake response for visuals only*`,
      actions: [
        {
          id: "1",
          type: "sell",
          description: "Sell 20% of SOL holdings",
          amount: "$142.00",
          reason: "Reduce from 60% to 40% allocation",
          checked: true,
        },
        {
          id: "2",
          type: "buy",
          description: "Buy ETH",
          amount: "$35.00",
          reason: "Increase ETH from 15% to 20%",
          checked: true,
        },
        {
          id: "3",
          type: "buy",
          description: "Buy DeFi Bundle",
          amount: "$71.00",
          reason: "Add 10% DeFi allocation",
          checked: true,
        },
        {
          id: "4",
          type: "buy",
          description: "Add to USDC Stable Earn",
          amount: "$36.00",
          reason: "Increase stable yield position",
          checked: false,
        },
      ],
    },
  },
};

const FAKE_CHAT_RESPONSES: Record<string, string> = {
  default:
    "⚠️ *This is a fake response for visuals only.*\n\nIn the real version, I'll analyze your question using AI and give you personalized advice based on your portfolio and market conditions.",
  risk: "Based on your profile, your current risk level is **moderate-high** due to SOL concentration. Consider diversifying into stables or ETH to reduce volatility.\n\n⚠️ *Fake response for visuals only*",
  portfolio:
    "Your current allocation:\n\n• **SOL**: 60% ($426)\n• **USDC**: 25% ($178)\n• **ETH**: 15% ($107)\n\n⚠️ *Fake response for visuals only*",
  buy: "Based on current conditions, consider:\n\n1. **DeFi Bundle** - Diversified exposure\n2. **ETH** - L1 diversification\n3. **Stable Earn** - 8% APY\n\n⚠️ *Fake response for visuals only*",
};

export default function Chat() {
  const [selectedService, setSelectedService] = useState<ServiceType>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [currentStep, setCurrentStep] = useState<FlowStep>("question_1");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [userCredits] = useState(5);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const addAssistantMessage = (content: string, actions?: ActionItem[]) => {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "assistant",
        content,
        timestamp: new Date(),
        actions,
      },
    ]);
  };

  const addUserMessage = (content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "user",
        content,
        timestamp: new Date(),
      },
    ]);
  };

  const startService = (serviceId: ServiceType) => {
    if (!serviceId) return;

    setSelectedService(serviceId);
    setMessages([]);
    setQuestionIndex(0);
    setCurrentStep("question_1");
    setActions([]);

    setTimeout(() => {
      const flow = SERVICE_FLOWS[serviceId];
      addAssistantMessage(flow.questions[0].message);
    }, 300);
  };

  const handleOptionSelect = (option: string) => {
    if (!selectedService) return;

    addUserMessage(option);
    setIsTyping(true);

    const flow = SERVICE_FLOWS[selectedService];
    const nextIndex = questionIndex + 1;

    setTimeout(() => {
      setIsTyping(false);

      if (nextIndex < flow.questions.length) {
        setQuestionIndex(nextIndex);
        setCurrentStep(`question_${nextIndex + 1}` as FlowStep);
        addAssistantMessage(flow.questions[nextIndex].message);
      } else {
        setCurrentStep("analyzing");
        addAssistantMessage(flow.analyzing);

        setTimeout(() => {
          setIsTyping(true);
          setTimeout(() => {
            setIsTyping(false);
            setCurrentStep("results");
            addAssistantMessage(flow.results.message, flow.results.actions);
            if (flow.results.actions) setActions(flow.results.actions);
          }, 2000);
        }, FAKE_DELAY);
      }
    }, FAKE_DELAY);
  };

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    const userMessage = inputValue.trim().toLowerCase();
    addUserMessage(inputValue);
    setInputValue("");
    setIsTyping(true);

    setTimeout(() => {
      setIsTyping(false);

      let response = FAKE_CHAT_RESPONSES.default;
      if (userMessage.includes("risk")) response = FAKE_CHAT_RESPONSES.risk;
      else if (
        userMessage.includes("portfolio") ||
        userMessage.includes("allocation")
      )
        response = FAKE_CHAT_RESPONSES.portfolio;
      else if (userMessage.includes("buy") || userMessage.includes("recommend"))
        response = FAKE_CHAT_RESPONSES.buy;

      addAssistantMessage(response);
    }, FAKE_DELAY);
  };

  const handleActionToggle = (actionId: string) => {
    setActions((prev) =>
      prev.map((action) =>
        action.id === actionId
          ? { ...action, checked: !action.checked }
          : action
      )
    );
  };

  const handleBack = () => {
    setSelectedService(null);
    setMessages([]);
    setCurrentStep("question_1");
    setQuestionIndex(0);
    setActions([]);
  };

  const getCurrentOptions = () => {
    if (!selectedService) return null;
    if (currentStep === "analyzing" || currentStep === "results") return null;

    const flow = SERVICE_FLOWS[selectedService];
    return flow.questions[questionIndex]?.options || null;
  };

  const selectedActions = actions.filter((a) => a.checked);
  const totalValue = selectedActions.reduce((sum, action) => {
    const amount = parseFloat(action.amount.replace("$", ""));
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  const havenFee = totalValue * 0.01;

  // ✅ Haven-styled landing
  if (!selectedService) {
    return (
      <div className="haven-card flex h-full flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b bg-card/80 px-4 py-4 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border bg-secondary shadow-fintech-sm">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground">
                Haven Advisor
              </h2>
              <p className="text-sm text-muted-foreground">
                Your AI portfolio manager
              </p>
            </div>
          </div>
        </div>

        {/* Placeholder Banner */}
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2">
          <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Placeholder — fake responses for visuals only</span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border bg-secondary px-4 py-2 text-sm">
              <Coins className="h-4 w-4 text-primary" />
              <span className="text-foreground/90">
                {userCredits} credits available
              </span>
            </div>

            <h3 className="text-xl font-semibold text-foreground">
              What would you like to do today?
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a service to get started.
            </p>
          </div>

          {/* Services */}
          <div className="space-y-3">
            {SERVICES.map((service) => {
              const Icon = service.icon;
              return (
                <motion.button
                  key={service.id}
                  onClick={() => startService(service.id)}
                  className={[
                    "w-full text-left",
                    "haven-card-soft px-4 py-4",
                    "hover:bg-accent/60 transition-colors",
                  ].join(" ")}
                  whileTap={{ scale: 0.99 }}
                >
                  <div className="flex items-start gap-4">
                    <div className="grid h-12 w-12 place-items-center rounded-2xl border bg-background shadow-fintech-sm">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="truncate font-semibold text-foreground">
                          {service.title}
                        </h4>
                        <span
                          className={`text-xs font-medium ${service.costTone}`}
                        >
                          {service.cost}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {service.description}
                      </p>
                    </div>

                    <ArrowRight className="mt-1 h-5 w-5 text-muted-foreground" />
                  </div>
                </motion.button>
              );
            })}
          </div>

          {/* Small feature chips */}
          <div className="mt-8 grid grid-cols-3 gap-3">
            {[
              { icon: Shield, label: "Risk", tone: "text-primary" },
              { icon: TrendingUp, label: "Growth", tone: "text-primary" },
              { icon: Zap, label: "Actions", tone: "text-primary" },
            ].map((f) => (
              <div
                key={f.label}
                className="rounded-2xl border bg-card/60 p-3 text-center shadow-fintech-sm"
              >
                <f.icon className={`mx-auto h-5 w-5 ${f.tone}`} />
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {f.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t bg-card/80 px-4 py-3 text-center text-[11px] text-muted-foreground">
          1 free overview per month • Credits never expire
        </div>
      </div>
    );
  }

  // ✅ Chat view
  return (
    <div className="haven-card flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-card/80 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="grid h-9 w-9 place-items-center rounded-full border bg-secondary text-foreground/80 shadow-fintech-sm hover:bg-accent"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="grid h-10 w-10 place-items-center rounded-2xl border bg-secondary shadow-fintech-sm">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>

          <div className="min-w-0">
            <h3 className="truncate font-semibold text-foreground">
              {SERVICES.find((s) => s.id === selectedService)?.title}
            </h3>
            <p className="text-xs text-muted-foreground">Haven Advisor</p>
          </div>
        </div>

        <div className="haven-pill">
          <Coins className="h-3.5 w-3.5 text-primary" />
          <span>{userCredits}</span>
        </div>
      </div>

      {/* Placeholder Banner */}
      <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2">
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>Placeholder — fake responses for visuals only</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <AnimatePresence>
          {messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
              >
                {/* Avatar */}
                <div
                  className={[
                    "grid h-8 w-8 place-items-center rounded-full border shadow-fintech-sm",
                    isUser
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary",
                  ].join(" ")}
                >
                  {isUser ? (
                    <User className="h-4 w-4" />
                  ) : (
                    <Bot className="h-4 w-4 text-primary" />
                  )}
                </div>

                {/* Bubble */}
                <div className={`max-w-[85%] ${isUser ? "text-right" : ""}`}>
                  <div
                    className={[
                      "rounded-3xl border px-4 py-3 text-sm leading-relaxed",
                      isUser
                        ? "bg-primary/15 border-primary/20 text-foreground"
                        : "bg-card/60 border-border text-foreground",
                    ].join(" ")}
                  >
                    {/* Keep your simple markdown-ish rendering */}
                    <div className="whitespace-pre-wrap">
                      {message.content.split("\n").map((line, i) => {
                        if (line.startsWith("## ")) {
                          return (
                            <div
                              key={i}
                              className="mb-1 mt-2 text-base font-semibold"
                            >
                              {line.replace("## ", "")}
                            </div>
                          );
                        }
                        if (line.startsWith("### ")) {
                          return (
                            <div
                              key={i}
                              className="mb-1 mt-2 text-sm font-semibold text-foreground/90"
                            >
                              {line.replace("### ", "")}
                            </div>
                          );
                        }

                        const parts = line.split(/(\*\*[^*]+\*\*)/g);
                        return (
                          <p key={i} className="mb-1 last:mb-0">
                            {parts.map((part, j) =>
                              part.startsWith("**") && part.endsWith("**") ? (
                                <strong
                                  key={j}
                                  className="font-semibold text-primary"
                                >
                                  {part.slice(2, -2)}
                                </strong>
                              ) : (
                                part
                              )
                            )}
                          </p>
                        );
                      })}
                    </div>
                  </div>

                  {/* Actions */}
                  {message.actions && message.actions.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15 }}
                      className="mt-3 rounded-3xl border bg-secondary p-4 text-left shadow-fintech-sm"
                    >
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        Recommended Actions
                      </div>

                      <div className="space-y-2">
                        {actions.map((action) => (
                          <label
                            key={action.id}
                            className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-card/60 p-3 hover:bg-accent/60"
                          >
                            <input
                              type="checkbox"
                              checked={action.checked}
                              onChange={() => handleActionToggle(action.id)}
                              className="mt-1 h-4 w-4 accent-[var(--primary)]"
                            />
                            <div className="flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-muted-foreground">
                                  {action.type === "sell"
                                    ? "SELL"
                                    : action.type === "swap"
                                      ? "SWAP"
                                      : "BUY"}
                                </span>
                                <span className="text-sm font-semibold text-foreground">
                                  {action.amount}
                                </span>
                              </div>

                              <div className="mt-0.5 text-sm text-foreground/90">
                                {action.description}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {action.reason}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>

                      <div className="mt-4 border-t pt-4">
                        <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                          <span>Selected: {selectedActions.length}</span>
                          <span>Haven fee: ${havenFee.toFixed(2)} (1%)</span>
                        </div>

                        <button className="haven-btn-primary">
                          Execute Selected Actions
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>
                    </motion.div>
                  )}

                  <p className="mt-1 px-2 text-[10px] text-muted-foreground">
                    {message.timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Typing */}
        {isTyping && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-3"
          >
            <div className="grid h-8 w-8 place-items-center rounded-full border bg-secondary shadow-fintech-sm">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="rounded-3xl border bg-card/60 px-4 py-3 shadow-fintech-sm">
              <div className="flex gap-1">
                {Array.from({ length: 3 }).map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      delay: i * 0.2,
                    }}
                    className="h-2 w-2 rounded-full bg-muted-foreground/60"
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Options */}
      {getCurrentOptions() && !isTyping && (
        <div className="border-t bg-card/70 px-4 py-3 backdrop-blur-xl">
          <div className="flex flex-wrap gap-2">
            {getCurrentOptions()!.map((option) => (
              <button
                key={option}
                onClick={() => handleOptionSelect(option)}
                className="rounded-full border bg-secondary px-4 py-2 text-sm text-foreground/90 hover:bg-accent/60"
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area (only after results) */}
      {currentStep === "results" && (
        <div className="border-t bg-card/70 px-4 py-3 backdrop-blur-xl">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder="Ask a follow-up question..."
              className="haven-input flex-1"
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim()}
              className="grid h-[46px] w-[46px] place-items-center rounded-2xl bg-primary text-primary-foreground shadow-fintech-sm disabled:opacity-50"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            1 credit per follow-up • {userCredits} credits remaining
          </p>
        </div>
      )}
    </div>
  );
}
