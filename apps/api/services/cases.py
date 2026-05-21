"""Case generation service.

Ports `backend/parligpt.py`'s `make_case` (Parliamentary) and
`make_mspdp_case` (MSPDP) to async functions sharing a single
`AsyncOpenAI` client. Prompt wording is preserved verbatim from the
legacy code to keep the output style stable.

`case_to_speech` / `say_case` (TTS) are intentionally dropped from v1.
"""

from __future__ import annotations

from services.openai_client import client

_MODEL = "gpt-4o-mini-2024-07-18"
_MAX_TOKENS = 1000
_TEMPERATURE = 0.0

_SYSTEM_PROMPT = (
    "You are a parliamentary debater. You are required to make a debate case "
    "using the case template provided for you. Give your responses in markdown "
    "text. Please format them so that the response is coherent and visually "
    "appealing."
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
    "Contention 1 Template:\n"
    "Claim { for claim, write a brief phrase tagline for the point of the contention }\n"
    "Warrant { warrants should have statistic-based evidence (Please do not falsify information that you cite.) followed by a link { a link is reasoning provided to get from the evidence to a larger impact { an impact is a relevant societal change (common impacts include poverty, death, climate change, etc.) } } }:\n"
    "- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n"
    "Impacts:\n"
    "- Summation of impacts { this summation of impacts should contain an impact calculus { an impact calculus refers to the probability of a given impact happening, the magnitude of the impact itself (aka how many people/things/environment/etc. the impact effects), the timeframe of the impact happening, and the reversibility of the impact on society (can it be undone) } }\n"
    "Contention 2 Template:\n"
    "Claim { for claim, write a brief phrase tagline for the point of the contention }\n"
    "Warrant { warrants should have statistic-based evidence followed by a link { a link is reasoning provided to get from the evidence to a larger impact { an impact is a relevant societal change (common impacts include poverty, death, climate change, etc.) } } }:\n"
    "- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n"
    "Impacts:\n"
    "- Summation of impacts { this summation of impacts should contain an impact calculus { an impact calculus refers to the probability of a given impact happening, the magnitude of the impact itself (aka how many people/things/environment/etc. the impact effects), the timeframe of the impact happening, and the reversibility of the impact on society (can it be undone) } }\n"
    "Contention 3 Template:\n"
    "Claim { for claim, write a brief phrase tagline for the point of the contention }\n"
    "Warrant { warrants should have statistic-based evidence followed by a link { a link is reasoning provided to get from the evidence to a larger impact { an impact is a relevant societal change (common impacts include poverty, death, climate change, etc.) } } }:\n"
    "- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n"
    "Impacts:\n"
    "- Summation of impacts { this summation of impacts should contain an impact calculus { an impact calculus refers to the probability of a given impact happening, the magnitude of the impact itself (aka how many people/things/environment/etc. the impact effects), the timeframe of the impact happening, and the reversibility of the impact on society (can it be undone) } }\n"
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
    "Contention 1 Template:\n"
    "Claim { for claim, write a brief phrase tagline for the point of the contention }\n"
    "Warrant { warrants should have statistic-based evidence (Please do not falsify information that you cite.) followed by a link { a link is reasoning provided to get from the evidence to a larger impact { an impact is a relevant societal change (common impacts include poverty, death, climate change, etc.) } } }:\n"
    "- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n"
    "Impacts:\n"
    "- Summation of impacts { this summation of impacts should contain an impact calculus { an impact calculus refers to the probability of a given impact happening, the magnitude of the impact itself (aka how many people/things/environment/etc. the impact effects), the timeframe of the impact happening, and the reversibility of the impact on society (can it be undone) } }\n"
    "Contention 2 Template:\n"
    "Claim { for claim, write a brief phrase tagline for the point of the contention }\n"
    "Warrant { warrants should have statistic-based evidence followed by a link { a link is reasoning provided to get from the evidence to a larger impact { an impact is a relevant societal change (common impacts include poverty, death, climate change, etc.) } } }:\n"
    "- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n"
    "Impacts:\n"
    "- Summation of impacts { this summation of impacts should contain an impact calculus { an impact calculus refers to the probability of a given impact happening, the magnitude of the impact itself (aka how many people/things/environment/etc. the impact effects), the timeframe of the impact happening, and the reversibility of the impact on society (can it be undone) } }\n"
    "Contention 3 Template:\n"
    "Claim { for claim, write a brief phrase tagline for the point of the contention }\n"
    "Warrant { warrants should have statistic-based evidence followed by a link { a link is reasoning provided to get from the evidence to a larger impact { an impact is a relevant societal change (common impacts include poverty, death, climate change, etc.) } } }:\n"
    "- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n- Evidence + Link\n- Internal Link\n- Impact\n"
    "Impacts:\n"
    "- Summation of impacts { this summation of impacts should contain an impact calculus { an impact calculus refers to the probability of a given impact happening, the magnitude of the impact itself (aka how many people/things/environment/etc. the impact effects), the timeframe of the impact happening, and the reversibility of the impact on society (can it be undone) } }\n"
)

_MSPDP_AFF_USER = (
    "Below is a parliamentary case template. You are the affirmative side on the following topic: {topic}. \n"
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

_MSPDP_NEG_SYSTEM = (
    "You are a parliamentary debater. You are required to make a debate case "
    "using the case template provided for you. Give your responses in markdown "
    "text. Please format them so that the response is coherent and visually "
    "appealing. "
)

_MSPDP_NEG_USER = (
    "Below is a parliamentary case template. You are the negation side on the following topic: {topic}. \n"
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
    user = template.replace("{topic}", topic)
    return await _chat(_SYSTEM_PROMPT, user)


async def make_mspdp_case(topic: str, side: str) -> str:
    """Generate an MSPDP debate case in markdown."""
    if side == "aff":
        user = _MSPDP_AFF_USER.replace("{topic}", topic)
        return await _chat(_SYSTEM_PROMPT, user)
    user = _MSPDP_NEG_USER.replace("{topic}", topic)
    return await _chat(_MSPDP_NEG_SYSTEM, user)
