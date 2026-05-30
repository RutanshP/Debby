"""Case generation service.

Ports `backend/parligpt.py`'s `make_case` (Parliamentary) and
`make_mspdp_case` (MSPDP) to async functions sharing a single
`AsyncOpenAI` client.

`case_to_speech` / `say_case` (TTS) are intentionally dropped from v1.
"""

from __future__ import annotations

from services.openai_client import client

_MODEL = "gpt-4o-mini-2024-07-18"
_MAX_TOKENS = 2500
_TEMPERATURE = 0.0

_BASE_SYSTEM_PROMPT = (
    "You are a debate coach and competitive debater. You are required to make a debate case "
    "using the case template provided for you. Give your responses in markdown "
    "text. Please format them so that the response is coherent and visually "
    "appealing. Return only markdown, not HTML and not a fenced code block. "
    "Use markdown headings for sections, bullet lists for arguments, and bold labels."
)

_STRUCTURE_SYSTEM_PROMPT = (
    _BASE_SYSTEM_PROMPT
    + " Write a tournament-style parliamentary debate case. For Parli format, "
    "classify the round as policy, value, or fact. Always use TULI for policy "
    "and value rounds: **Tagline**, **Uniqueness**, **Links**, and **Impacts** "
    "for each contention, advantage, or disadvantage. For fact rounds, use "
    "Claim/Warrant/Impact. Prefer specific link chains, solvency, "
    "internal links, and impact calculus over generic explanation. In AFF "
    "policy rounds, uniqueness proves the status quo is bad and that a plan "
    "text is needed to change it; links explain how the plan solves that "
    "status quo harm; internal links are the additional causal steps between "
    "the solved harm and the terminal impact. In NEG policy rounds, uniqueness "
    "usually proves the status quo contains valuable things that are working "
    "or worth preserving; links prove the AFF plan destroys, weakens, trades "
    "off with, or creates disadvantages to those good status quo conditions. "
    "If NEG chooses to run a counterplan, it may also include a counterplan "
    "advantage using AFF-style solvency links, but the counterplan must not "
    "contradict the NEG disadvantages to the AFF plan."
)

_PARLI_SYSTEM_PROMPT = _STRUCTURE_SYSTEM_PROMPT

_PARLI_OUTPUT_RULES = (
    "\n\nOutput requirements:\n"
    "- Return polished markdown only.\n"
    "- Do not output the raw template or bracketed instructions.\n"
    "- Start with a heading naming the side and topic.\n"
    "- Include round type, weighing mechanism, and definitions/background.\n"
    "- Definitions must be operational and concrete. If the resolution uses terms like significantly increase, substantially increase, reduce, expand, restrict, or prioritize, define them with a measurable threshold such as a percentage, dollar amount, legal standard, or scope limit.\n"
    "- If the topic is policy-oriented, include a plan text or counterplan when appropriate, plus solvency.\n"
    "- Plan text must be specific enough to implement. If the plan increases funding, name the amount or percentage increase, identify the funding recipient, and explain why that amount is greater than the status quo baseline. Do not use Normal Ways and Means as a substitute for an amount when the resolution asks to increase funding.\n"
    "- Classify the round as exactly one of: **Policy**, **Value**, or **Fact**.\n"
    "- For Parli policy and value rounds, write 2-3 contentions/advantages/disadvantages using this TULI structure:\n"
    "  - Use the contention/advantage/disadvantage heading itself as the tagline, around 5 words, rather than writing a generic heading plus a separate tagline.\n"
    "  - **Tagline:** one strategic phrase around 5 words naming the contention.\n"
    "  - **Uniqueness:** multiple U1/U2/U3 sub-uniquenesses. Each U point must have a short claim/tagline followed by at least 4 evidence bullets underneath it; use more than 4 when the topic is complex or the claim needs more support. Those evidence bullets must include concrete statistics, named institutions, recent events, comparative baselines, rankings, percentages, dollar figures, or clearly labeled analytical warrants. For AFF policy cases, prove the status quo harm exists now and is bad enough to justify the plan. For NEG policy cases, prove the status quo has good things worth preserving, such as innovation, stability, jobs, effective institutions, markets, deterrence, diplomacy, or existing reforms.\n"
    "  - **Links:** multiple L1/L2 link chains. Format every link as an arrow chain using `->`, not a paragraph. For AFF policy cases, show: plan passes -> mechanism changes -> uniqueness harm reduced -> impact access. For NEG policy cases, show: AFF plan passes -> good status quo condition disrupted -> internal consequence -> impact access.\n"
    "  - **Internal Links:** 2-4 downstream causal chains from the solved/disrupted harm to the terminal impact. Format internal links with `->` arrows. Example: homework increases stress -> worse sleep -> mental health decline -> lower retention -> family conflict.\n"
    "  - **Impacts:** terminal impact plus magnitude, probability, timeframe, and weighing.\n"
    "- For NEG disadvantages, model the structure as: U1/U2 good status quo conditions -> L1/L2 ways AFF disrupts them -> internal links -> terminal impact.\n"
    "- If NEG runs a counterplan, include a short counterplan text, solvency, and optionally one CP advantage. The CP advantage can use AFF-style links showing how the counterplan solves a harm, but keep it logically consistent with the disadvantages against AFF.\n"
    "- For Parli fact rounds, use Claim/Warrant/Impact instead of TULI because the burden is proving or disproving a factual statement.\n"
    "- Do not use Claim/Warrant/Impact headings in Parli policy or value rounds; use TULI headings instead.\n"
    "- Make the case more developed than a drill prompt: include specific mechanisms, examples, and quantitative estimates when reasonable, but do not fabricate exact citations. If you are uncertain about an exact statistic, use a qualified estimate or cite the type of source instead of inventing precision.\n"
)

_PARLI_TULI_CONTENTION_TEMPLATE = (
    "Contention Template:\n"
    "Contention Heading / Tagline { write the contention name as a brief strategic tagline, around 5 words }\n"
    "Uniqueness { include U1/U2/U3 sub-uniquenesses. Each U point needs a short claim plus at least 4 evidence/stat bullets underneath it. }\n"
    "Links { include L1/L2 link chains formatted with arrows, e.g. plan passes -> mechanism changes -> uniqueness harm reduced -> impact access. }\n"
    "Internal Links { include 2-4 downstream arrow chains from the solved/disrupted harm to the terminal impact. }\n"
    "Impacts { include terminal impact calculus: magnitude, probability, timeframe, reversibility, and weighing. }\n"
)

_PARLI_AFF_USER = (
    "Below is a parliamentary case template. You are the affirmative side on the following topic: {topic}. \n"
    " The only time you may make a plan text is in a policy round (refer to the case template for definitions of plan text or policy round). This case template uses \"[ ]\" to signify a definition or explanation of a debate term in the template. Use the affirmative top of case and ignore the negation top of case. Here is the case template:\n"
    "Affirmation Top of Case:\n"
    "Round Type { either a policy round { a policy round implies that some policy action will be taken by the resolution (e.g. “The United States Federal Government should implement a universal base income.” where the resolution implies that the policy action that will be taken is the implementation of a UBI) } , value round {a value round implies that the debate centers around comparing two things - often using words like prioritize and better than (e.g “When in conflict, healthcare companies should prioritize quality of patient care over patient privacy”). Another example of value rounds are harm than good/good than harm topics (e.g. “Homework does more good than harm.” where the debate centers around how debating whether it does “more harm than good”) }, or fact round { a fact round implies that there is some statement that is debated on whether it is a fact or fiction (e.g. Kamala Harris will win the 2024 election over Donald Trump) } }\n"
    "Weighing Mechanism { a weighing mechanism is a philosophical framework by which to judge the debate round. This is generally defaulted to net benefits { net benefits means the greatest amount of good for the greatest amount of people } under a utilitarian philosophical framework but can be changed by the debaters if they choose to set an alternative weighing mechanism. An example alternative weighing mechanism is biocentric net benefits under a utilitarian framework which means that the debate centers around the greatest amount of good for the greatest amounts of organisms on the planet. }\n"
    "Definitions/Background: { here you may define any ambiguous terms in the resolution or any terms that may be relevant to your debate case that you may reference many times. This often includes defining the scope of policy actions indicated in the resolution, or simply just ambiguous terms. Additionally, this is the place to add context for the resolution. }\n"
    "Plan Text: { Here, you may define the plan that the affirmative chooses to pass. This should only be included if the round type is a policy round. This plan MUST satisfy the resolution and be topical. Default plan text is the resolution text. }\n"
    "- Agent of Actor: { here, specify an entity that will pass the plan text that is specified above. (e.g. if plan text is “USFG should implement a UBI,” the agent of actor could be the United States Federal Government) }\n"
    "- Agent of Enforcer: { here, specify which entity will be in charge of enforcing/regulating this policy. (e.g. if the plan is the USFG should reduce illegal immigrants, the agent of enforcer would be ICE) }\n"
    "- Time frame: { here, specify when the policy will be implemented. Default is as soon as possible unless there is an advantage for a different time frame. }\n"
    "- Funding: { here specify the funding required in this policy. Additionally if needed, add where the money is coming from if it is a significant amount of money. Otherwise, say Normal Ways and Means (NWAM) }\n"
    "Negation Top of Case:\n"
    "Round Type { either a policy round { a policy round implies that some policy action will be taken by the resolution (e.g. “The United States Federal Government should implement a universal base income.” where the resolution implies that the policy action that will be taken is the implementation of a UBI) } , value round { a value round implies that the debate centers around how valuable something is (e.g. “Homework does more good than harm.” where the debate centers around how valuable homework is by debating whether it does “more good than harm”) }, or fact round { a fact round implies that there is some theory that is debated on whether it is a fact or fiction (e.g. Kamala Harris will win the 2024 election over Donald Trump) } }\n"
    "Weighing Mechanism { a weighing mechanism is a philosophical framework by which to judge the debate round. This is generally defaulted to net benefits { net benefits means the greatest amount of good for the greatest amount of people } under a utilitarian philosophical framework but can be changed by the debaters if they choose to set an alternative weighing mechanism. An example alternative weighing mechanism is biocentric net benefits under a utilitarian framework which means that the debate centers around the greatest amount of good for the greatest amounts of organisms on the planet. }\n"
    "Definitions/Background: { here you may define any ambiguous terms in the resolution or any terms that may be relevant to your debate case that you may reference many times. This often includes defining the scope of policy actions indicated in the resolution, or simply just ambiguous terms. Additionally, this is the place to add context for the resolution. }\n"
    "Plan Text: { Here, you may define a counter plan that the negation may choose to plan. This should only be included if the round type is a policy round AND if the topic is favorable to a counter plan. This plan MUST satisfy the resolution and be topical. This counterplan MUST be mutually exclusive to the passage of the resolution as a plan (there must be no way to pass the resolution plan and the plan text). }\n"
    "- Agent of Actor: { here, specify an entity that will pass the plan text that is specified above. (e.g. if plan text is “USFG should implement a UBI,” the agent of actor could be the United States Federal Government) }\n"
    "- Agent of Enforcer: { here, specify which entity will be in charge of enforcing/regulating this policy. (e.g. if the plan is the USFG should reduce illegal immigrants, the agent of enforcer would be ICE) } \n"
    "- Time frame: { here, specify when the policy will be implemented. Default is as soon as possible unless there is an advantage for a different time frame. }\n"
    "- Funding: { here specify the funding required in this policy. Additionally if needed, add where the money is coming from if it is a significant amount of money. Otherwise, say Normal Ways and Means (NWAM) }\n"
    + _PARLI_TULI_CONTENTION_TEMPLATE
)

_PARLI_NEG_USER = (
    "Below is a parliamentary case template. You are the negation side on the following topic: {topic}. \n"
    " The only time you may make a counterplan is in a policy round (refer to the case template for definitions of counterplan or policy round). If this round is a policy round (for information on what a policy round is, please refer to the case template.), you must argue that the action proposed by the resolution must not be taken. If this round is a value round (for information on what a value round is, please refer to the case template.), you must argue the inverse of the statement. for instance, if the topic is structured in the format \"x does more harm than good,\" you must argue \"x does more good than harm.\" Or, if the topic argues \"x is better than y,\" you must argue \"y is better than x.\" If this round is a fact round (for information on what a fact round is, please refer to the case template.), you must argue that the resolution being stated is untrue. This case template uses \"[ ]\" to signify a definition or explanation of a debate term in the template. Use the negation top of case and ignore the affirmative top of case. Here is the case template:\n"
    "Affirmation Top of Case:\n"
    "Round Type { either a policy round { a policy round implies that some policy action will be taken by the resolution (e.g. “The United States Federal Government should implement a universal base income.” where the resolution implies that the policy action that will be taken is the implementation of a UBI) } , value round {a value round implies that the debate centers around comparing two things - often using words like prioritize and better than (e.g “When in conflict, healthcare companies should prioritize quality of patient care over patient privacy”). Another example of value rounds are harm than good/good than harm topics (e.g. “Homework does more good than harm.” where the debate centers around how debating whether it does “more harm than good”) }, or fact round { a fact round implies that there is some statement that is debated on whether it is a fact or fiction (e.g. Kamala Harris will win the 2024 election over Donald Trump) } }\n"
    "Weighing Mechanism { a weighing mechanism is a philosophical framework by which to judge the debate round. This is generally defaulted to net benefits { net benefits means the greatest amount of good for the greatest amount of people } under a utilitarian philosophical framework but can be changed by the debaters if they choose to set an alternative weighing mechanism. An example alternative weighing mechanism is biocentric net benefits under a utilitarian framework which means that the debate centers around the greatest amount of good for the greatest amounts of organisms on the planet. }\n"
    "Definitions/Background: { here you may define any ambiguous terms in the resolution or any terms that may be relevant to your debate case that you may reference many times. This often includes defining the scope of policy actions indicated in the resolution, or simply just ambiguous terms. Additionally, this is the place to add context for the resolution. }\n"
    "Plan Text: { Here, you may define the plan that the affirmative chooses to pass. This should only be included if the round type is a policy round. This plan MUST satisfy the resolution and be topical. Default plan text is the resolution text. }\n"
    "- Agent of Actor: { here, specify an entity that will pass the plan text that is specified above. (e.g. if plan text is “USFG should implement a UBI,” the agent of actor could be the United States Federal Government) }\n"
    "- Agent of Enforcer: { here, specify which entity will be in charge of enforcing/regulating this policy. (e.g. if the plan is the USFG should reduce illegal immigrants, the agent of enforcer would be ICE) }\n"
    "- Time frame: { here, specify when the policy will be implemented. Default is as soon as possible unless there is an advantage for a different time frame. }\n"
    "- Funding: { here specify the funding required in this policy. Additionally if needed, add where the money is coming from if it is a significant amount of money. Otherwise, say Normal Ways and Means (NWAM) }\n"
    "Negation Top of Case:\n"
    "Round Type { either a policy round { a policy round implies that some policy action will be taken by the resolution (e.g. “The United States Federal Government should implement a universal base income.” where the resolution implies that the policy action that will be taken is the implementation of a UBI) } , value round { a value round implies that the debate centers around how valuable something is (e.g. “Homework does more good than harm.” where the debate centers around how valuable homework is by debating whether it does “more good than harm”) }, or fact round { a fact round implies that there is some theory that is debated on whether it is a fact or fiction (e.g. Kamala Harris will win the 2024 election over Donald Trump) } }\n"
    "Weighing Mechanism { a weighing mechanism is a philosophical framework by which to judge the debate round. This is generally defaulted to net benefits { net benefits means the greatest amount of good for the greatest amount of people } under a utilitarian philosophical framework but can be changed by the debaters if they choose to set an alternative weighing mechanism. An example alternative weighing mechanism is biocentric net benefits under a utilitarian framework which means that the debate centers around the greatest amount of good for the greatest amounts of organisms on the planet. }\n"
    "Definitions/Background: { here you may define any ambiguous terms in the resolution or any terms that may be relevant to your debate case that you may reference many times. This often includes defining the scope of policy actions indicated in the resolution, or simply just ambiguous terms. Additionally, this is the place to add context for the resolution. }\n"
    "Plan Text: { Here, you may define a counter plan that the negation may choose to plan. This should only be included if the round type is a policy round AND if the topic is favorable to a counter plan. This plan MUST satisfy the resolution and be topical. This counterplan MUST be mutually exclusive to the passage of the resolution as a plan (there must be no way to pass the resolution plan and the plan text). }\n"
    "- Agent of Actor: { here, specify an entity that will pass the plan text that is specified above. (e.g. if plan text is “USFG should implement a UBI,” the agent of actor could be the United States Federal Government) }\n"
    "- Agent of Enforcer: { here, specify which entity will be in charge of enforcing/regulating this policy. (e.g. if the plan is the USFG should reduce illegal immigrants, the agent of enforcer would be ICE) } \n"
    "- Time frame: { here, specify when the policy will be implemented. Default is as soon as possible unless there is an advantage for a different time frame. }\n"
    "- Funding: { here specify the funding required in this policy. Additionally if needed, add where the money is coming from if it is a significant amount of money. Otherwise, say Normal Ways and Means (NWAM) }\n"
    + _PARLI_TULI_CONTENTION_TEMPLATE
)

_MSPDP_AFF_USER = (
    "Below is an MSPDP case template. You are the affirmative side on the following topic: {topic}. \n"
    " The only time you may make a plan text is in a policy round (refer to the case template for definitions of plan text or policy round). You must argue for the resolution. This case template uses \"[ ]\" to signify a definition or explanation of a debate term in the template. Use the affirmative top of case and ignore the negation top of case. Here is the case template:\n"
    "Affirmation Top of Case:\n"
    "Round Type [ either a policy round [ a policy round implies that some policy action will be taken by the resolution (e.g. “The United States Federal Government should implement a universal base income.” where the resolution implies that the policy action that will be taken is the implementation of a UBI) ] , value round [a value round implies that the debate centers around comparing two things - often using words like prioritize and better than (e.g “When in conflict, healthcare companies should prioritize quality of patient care over patient privacy”). Another example of value rounds are harm than good/good than harm topics (e.g. “Homework does more good than harm.” where the debate centers around how debating whether it does “more harm than good”) ], or fact round [ a fact round implies that there is some  that is debated on whether it is a fact or fiction (e.g. Kamala Harris will win the 2024 election over Donald Trump) ] ]\n"
    "Weighing Mechanism [ a weighing mechanism is a philosophical framework by which to judge the debate round. This is generally defaulted to net benefits [ net benefits means the greatest amount of good for the greatest amount of people ] under a utilitarian philosophical framework but can be changed by the debaters if they choose to set an alternative weighing mechanism. An example alternative weighing mechanism is biocentric net benefits under a utilitarian framework which means that the debate centers around the greatest amount of good for the greatest amounts of organisms on the planet. ]\n"
    "Definitions/Background: [ here you may define any ambiguous terms in the resolution or any terms that may be relevant to your debate case that you may reference many times. This often includes defining the scope of policy actions indicated in the resolution, or simply just ambiguous terms. Additionally, this is the place to add context for the resolution.\n"
    "Plan Text: [ Here, you may define the plan that the affirmative chooses to pass. This should only be included if the round type is a policy round. This plan MUST satisfy the resolution and be topical. Default plan text is the resolution text. ]\n"
    "- Agent of Actor: [ here, specify an entity that will pass the plan text that is specified above. (e.g. if plan text is “USFG should implement a UBI,” the agent of actor could be the United States Federal Government) ]\n"
    "- Agent of Enforcer: [ here, specify which entity will be in charge of enforcing/regulating this policy. (e.g. if the plan is the USFG should reduce illegal immigrants, the agent of enforcer would be ICE) ]\n"
    "- Time frame: [ here, specify when the policy will be implemented. Default is as soon as possible unless there is an advantage for a different time frame. ]\n"
    "- Funding: [ here specify the funding required in this policy. Additionally if needed, add where the money is coming from if it is a significant amount of money. Otherwise, say Normal Ways and Means (NWAM) ]\n"
    "AFF Contention Template: Normally have 2-3 Contentions (Each ARESI is one contention)\n"
    "Assertion[ for assertion, write a brief phrase tagline for the point of the contention ]\n"
    "Reasoning[ add logic based arguments for your tagline\n"
    "Evidence[ add statistics/analysis/numbers/examples and other evidence to support your logical reasoning. This should be right under the reasoning. Please provide multiple pieces of evidence to support your reasoning. These multiple pieces of evidence may have multiple sources. Please do not falsify information that you cite.]\n"
    "Source[at the end of the evidence, you need to cite your sources]\n"
    "Impacts[ Summation of impacts [ this summation of impacts should contain an impact calculus [ an impact calculus refers to the probability of a given impact happening, the magnitude of the impact itself (aka how many people/things/environment/etc. the impact effects), the timeframe of the impact happening, and the reversibility of the impact on society (can it be undone) ] ]\n"
    "Negation Top of Case:\n"
    "Round Type [ either a policy round [ a policy round implies that some policy action will be taken by the resolution (e.g. “The United States Federal Government should implement a universal base income.” where the resolution implies that the policy action that will be taken is the implementation of a UBI) ] , value round [ a value round implies that the debate centers around how valuable something is (e.g. “Homework does more good than harm.” where the debate centers around how valuable homework is by debating whether it does “more good than harm”) ], or fact round [ a fact round implies that there is some theory that is debated on whether it is a fact or fiction (e.g. Kamala Harris will win the 2024 election over Donald Trump) ] ]\n"
    "Weighing Mechanism [ a weighing mechanism is a philosophical framework by which to judge the debate round. This is generally defaulted to net benefits [ net benefits means the greatest amount of good for the greatest amount of people ] under a utilitarian philosophical framework but can be changed by the debaters if they choose to set an alternative weighing mechanism. An example alternative weighing mechanism is biocentric net benefits under a utilitarian framework which means that the debate centers around the greatest amount of good for the greatest amounts of organisms on the planet. ]\n"
    "Definitions/Background: [ here you may define any ambiguous terms in the resolution or any terms that may be relevant to your debate case that you may reference many times. This often includes defining the scope of policy actions indicated in the resolution, or simply just ambiguous terms. Additionally, this is the place to add context for the resolution. ]\n"
    "Neg Contention Template: Normally have 2-3 Contentions (Each ARESI is one contention)\n"
    "Assertion[ for assertion, write a brief phrase tagline for the point of the contention ]\n"
    "Reasoning[ add logic based arguments for your tagline\n"
    "Evidence[ add statistics/analysis/numbers/examples and other evidence to support your logical reasoning. This should be right under the reasoning.]\n"
    "Source[at the end of the evidence, you need to cite your sources]\n"
    "Impacts[ Summation of impacts [ this summation of impacts should contain an impact calculus [ an impact calculus refers to the probability of a given impact happening, the magnitude of the impact itself (aka how many people/things/environment/etc. the impact effects), the timeframe of the impact happening, and the reversibility of the impact on society (can it be undone) ] ]"
)

_MSPDP_SYSTEM_PROMPT = (
    _BASE_SYSTEM_PROMPT
    + " For MSPDP format, classify the round as policy, value, or fact. Use "
    "ARESI for policy and value rounds: **Assertion**, **Reasoning**, "
    "**Evidence**, **Source**, and **Impact**. Use Claim/Warrant/Impact for "
    "fact rounds."
)

_MSPDP_OUTPUT_RULES = (
    "\n\nOutput requirements:\n"
    "- Return polished markdown only.\n"
    "- Do not output the raw template or bracketed instructions.\n"
    "- Start with a heading naming the side and topic.\n"
    "- Classify the round as exactly one of: **Policy**, **Value**, or **Fact**.\n"
    "- For MSPDP policy and value rounds, write 2-3 contentions using ARESI:\n"
    "  - **Assertion:** a concise tagline/claim for the contention.\n"
    "  - **Reasoning:** logical explanation connecting the assertion to the round.\n"
    "  - **Evidence:** concrete support such as statistics, examples, recent events, comparisons, or named institutions.\n"
    "  - **Source:** source names or source types when available; do not fabricate exact citations.\n"
    "  - **Impact:** magnitude, probability, timeframe, and weighing.\n"
    "- For MSPDP fact rounds, use Claim/Warrant/Impact because the burden is proving or disproving a factual statement.\n"
)

_MSPDP_NEG_USER = (
    "Below is an MSPDP case template. You are the negation side on the following topic: {topic}. \n"
    " If this round is a policy round (for information on what a policy round is, please refer to the case template.), you must argue that the action proposed by the resolution must not be taken. If this round is a value round (for information on what a value round is, please refer to the case template.), you must argue the inverse of the statement. for instance, if the topic is structured in the format \"x does more harm than good,\" you must argue \"x does more good than harm.\" Or, if the topic argues \"x is better than y,\" you must argue \"y is better than x.\" If this round is a fact round (for information on what a fact round is, please refer to the case template.), you must argue that the resolution being stated is untrue. This case template uses \"[ ]\" to signify a definition or explanation of a debate term in the template. Use the negation top of case and ignore the affirmative top of case. Here is the case template:\n"
    "Affirmation Top of Case:\n"
    "Round Type [ either a policy round [ a policy round implies that some policy action will be taken by the resolution (e.g. “The United States Federal Government should implement a universal base income.” where the resolution implies that the policy action that will be taken is the implementation of a UBI) ] , value round [ a value round implies that the debate centers around comparing two thing - often using words like prioritize, and better (e.g “When in conflict, Healthcare Companies ought to prioritize quality of care over patient privacy”). Another example of a value round is a harm than good/good than harm topic (e.g. “Homework does more good than harm.” where the debate centers around debating whether it does “harm than good”) ], or fact round [ a fact round implies that there is some statement that is debated on whether it is a fact or fiction (e.g. Kamala Harris will win the 2024 election over Donald Trump) ] ]\n"
    "Weighing Mechanism [ a weighing mechanism is a philosophical framework by which to judge the debate round. This is generally defaulted to net benefits [ net benefits means the greatest amount of good for the greatest amount of people ] under a utilitarian philosophical framework but can be changed by the debaters if they choose to set an alternative weighing mechanism. An example alternative weighing mechanism is biocentric net benefits under a utilitarian framework which means that the debate centers around the greatest amount of good for the greatest amounts of organisms on the planet. ]\n"
    "Definitions/Background: [ here you may define any ambiguous terms in the resolution or any terms that may be relevant to your debate case that you may reference many times. This often includes defining the scope of policy actions indicated in the resolution, or simply just ambiguous terms. Additionally, this is the place to add context for the resolution.\n"
    "Plan Text: [ Here, you may define the plan that the affirmative chooses to pass. This should only be included if the round type is a policy round. This plan MUST satisfy the resolution and be topical. Default plan text is the resolution text. ]\n"
    "- Agent of Actor: [ here, specify an entity that will pass the plan text that is specified above. (e.g. if plan text is “USFG should implement a UBI,” the agent of actor could be the United States Federal Government) ]\n"
    "- Agent of Enforcer: [ here, specify which entity will be in charge of enforcing/regulating this policy. (e.g. if the plan is the USFG should reduce illegal immigrants, the agent of enforcer would be ICE) ]\n"
    "- Time frame: [ here, specify when the policy will be implemented. Default is as soon as possible unless there is an advantage for a different time frame. ]\n"
    "- Funding: [ here specify the funding required in this policy. Additionally if needed, add where the money is coming from if it is a significant amount of money. Otherwise, say Normal Ways and Means (NWAM) ]\n"
    "AFF Contention Template: Normally have 2-3 Contentions (Each ARESI is one contention)\n"
    "Assertion[ for assertion, write a brief phrase tagline for the point of the contention ]\n"
    "Reasoning[ add logic based arguments for your tagline\n"
    "Evidence[ add statistics/analysis/numbers/examples and other evidence to support your logical reasoning. This should be right under the reasoning. Please provide multiple pieces of evidence to support your reasoning. These multiple pieces of evidence may have multiple sources. Please do not falsify information that you cite.]\n"
    "Source[at the end of the evidence, you need to cite your sources]\n"
    "Impacts[ Summation of impacts [ this summation of impacts should contain an impact calculus [ an impact calculus refers to the probability of a given impact happening, the magnitude of the impact itself (aka how many people/things/environment/etc. the impact effects), the timeframe of the impact happening, and the reversibility of the impact on society (can it be undone) ] ]\n"
    "Negation Top of Case:\n"
    "Round Type [ either a policy round [ a policy round implies that some policy action will be taken by the resolution (e.g. “The United States Federal Government should implement a universal base income.” where the resolution implies that the policy action that will be taken is the implementation of a UBI) ] , value round [ a value round implies that the debate centers around how valuable something is (e.g. “Homework does more good than harm.” where the debate centers around how valuable homework is by debating whether it does “more good than harm”) ], or fact round [ a fact round implies that there is some theory that is debated on whether it is a fact or fiction (e.g. Kamala Harris will win the 2024 election over Donald Trump) ] ]\n"
    "Weighing Mechanism [ a weighing mechanism is a philosophical framework by which to judge the debate round. This is generally defaulted to net benefits [ net benefits means the greatest amount of good for the greatest amount of people ] under a utilitarian philosophical framework but can be changed by the debaters if they choose to set an alternative weighing mechanism. An example alternative weighing mechanism is biocentric net benefits under a utilitarian framework which means that the debate centers around the greatest amount of good for the greatest amounts of organisms on the planet. ]\n"
    "Definitions/Background: [ here you may define any ambiguous terms in the resolution or any terms that may be relevant to your debate case that you may reference many times. This often includes defining the scope of policy actions indicated in the resolution, or simply just ambiguous terms. Additionally, this is the place to add context for the resolution. ]\n"
    "Neg Contention Template: Normally have 2-3 Contentions (Each ARESI is one contention)\n"
    "Assertion[ for assertion, write a brief phrase tagline for the point of the contention ]\n"
    "Reasoning[ add logic based arguments for your tagline\n"
    "Evidence[ add statistics/analysis/numbers/examples and other evidence to support your logical reasoning. This should be right under the reasoning.]\n"
    "Source[at the end of the evidence, you need to cite your sources]\n"
    "Impacts[ Summation of impacts [ this summation of impacts should contain an impact calculus [ an impact calculus refers to the probability of a given impact happening, the magnitude of the impact itself (aka how many people/things/environment/etc. the impact effects), the timeframe of the impact happening, and the reversibility of the impact on society (can it be undone) ] ]"
)


async def _chat(system: str, user: str) -> str:
    response = await client.chat.completions.create(
        model=_MODEL,
        max_tokens=_MAX_TOKENS,
        temperature=_TEMPERATURE,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return response.choices[0].message.content or ""


async def make_case(topic: str, side: str) -> str:
    """Generate a Parliamentary debate case in markdown.

    `side` is "aff" for affirmative or "neg" for negation.
    """
    template = _PARLI_AFF_USER if side == "aff" else _PARLI_NEG_USER
    # The prompt templates contain literal "{...}" braces that aren't
    # format-string placeholders, so substitute the topic with plain
    # replacement instead of .format().
    user = template.replace("{topic}", topic) + _PARLI_OUTPUT_RULES
    return await _chat(_PARLI_SYSTEM_PROMPT, user)


async def make_mspdp_case(topic: str, side: str) -> str:
    """Generate an MSPDP debate case in markdown."""
    if side == "aff":
        user = _MSPDP_AFF_USER.replace("{topic}", topic) + _MSPDP_OUTPUT_RULES
        return await _chat(_MSPDP_SYSTEM_PROMPT, user)
    user = _MSPDP_NEG_USER.replace("{topic}", topic) + _MSPDP_OUTPUT_RULES
    return await _chat(_MSPDP_SYSTEM_PROMPT, user)
