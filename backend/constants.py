# constants.py
# This file contains all the prompts used across the application

# Constants for the learning API

# File extensions
ALLOWED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg']
ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v']
ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.doc']

# System messages
TRANSCRIBER_SYSTEM_MESSAGE = "You are a professional transcriber. Transcribe the content accurately without adding any commentary or structure."
SUMMARIZER_SYSTEM_MESSAGE = "You are a professional summarizer who creates structured summaries. Never provide transcripts."
TEXT_SUMMARIZER_SYSTEM_MESSAGE = "You are a professional summarizer who creates concise, well-structured summaries. Focus on extracting key insights and main points."

# Structured summary format
STRUCTURED_SUMMARY_FORMAT = """Create a structured summary of the following content with this exact format:

**Main Topic/Theme:**
[One sentence describing the primary subject]

**Key Points:**
• [Point 1]
• [Point 2]
• [Point 3]
• [Point 4]

**Core Message:**
[One paragraph explaining the central takeaway]

**Important Statistics/Data:**
• [Statistic 1]
• [Statistic 2]
• [Statistic 3]

**Context:**
[One paragraph explaining why this topic matters]

Content to summarize:
{content}"""

# Transcription prompts
AUDIO_TRANSCRIPTION_PROMPT = "Please transcribe this audio content accurately."
VIDEO_TRANSCRIPTION_PROMPT = "Please transcribe this video content accurately."

# Existing prompts
TEXT_SUMMARIZATION_PROMPT = """Please provide a comprehensive summary of the following text. Focus on:

1. Main ideas and key points
2. Important details and supporting evidence
3. Central message or conclusion
4. Context and significance

Make the summary clear, concise, and well-structured."""

MINDMAP_GENERATION_PROMPT = """Create a mindmap JSON structure for the given topic. The structure should be suitable for D3.js visualization.

Requirements:
- Root node should be the main topic
- Include 3-5 main branches with relevant subtopics
- Each node should have: "name" (string), "children" (array of child nodes)
- Keep it concise but comprehensive
- Focus on logical organization and relationships

Return only valid JSON without any additional text."""

FLASHCARD_GENERATION_PROMPT = """Create flashcards for the given content. Each flashcard should have:

1. A clear question or concept on the front
2. A comprehensive answer or explanation on the back
3. Focus on key concepts, definitions, and important points

Return the flashcards as a JSON array with objects containing:
- "front": The question or concept
- "back": The answer or explanation

Return only valid JSON without any additional text."""

def get_mcq_quiz_prompt(num_questions: int) -> str:
    """Generate MCQ quiz prompt with specified number of questions."""
    return f"""Create {num_questions} multiple choice questions based on the given content.

Requirements:
- Questions should be clear and relevant to the content
- Each question should have 4 options (A, B, C, D)
- Only one option should be correct
- Include explanations for the correct answer
- Cover different aspects of the content
- Questions should vary in difficulty

Return the questions in this format:
Question 1: [Question text]
A) [Option A]
B) [Option B]
C) [Option C]
D) [Option D]
Correct Answer: [A/B/C/D]
Explanation: [Why this is correct]

Continue for all {num_questions} questions."""

# Topic extraction prompt
TOPIC_EXTRACTION_PROMPT = """Analyze the following content and extract a concise 1-2 word topic that best represents the main subject.

Requirements:
- Extract only 1-2 words maximum
- Focus on the primary subject or theme
- Make it specific and meaningful
- Avoid generic terms like "content" or "information"
- Use nouns that capture the essence

Examples:
- "Machine Learning" (not "AI and machine learning concepts")
- "Climate Change" (not "Environmental science and climate")
- "Python Programming" (not "Programming languages and Python")

Content to analyze:
{input}

Return only the topic words without quotes or additional text."""

# Mindmap Generation Prompts
MINDMAP_GENERATION_PROMPT = """
You are a mindmap generator. Create a mindmap structure for the given topic.

CRITICAL: Return ONLY a valid JSON object. Do not include any other text, explanations, or formatting.

The JSON must follow this exact structure:
{{
    "name": "Main Topic",
    "children": [
        {{
            "name": "Subtopic 1",
            "children": [
                {{"name": "Detail 1"}},
                {{"name": "Detail 2"}}
            ]
        }},
        {{
            "name": "Subtopic 2", 
            "children": [
                {{"name": "Detail 3"}},
                {{"name": "Detail 4"}}
            ]
        }}
    ]
}}

Requirements:
- Include 3-5 main subtopics
- Each subtopic should have 2-4 details
- Use clear, concise names
- Make it suitable for D3.js tree visualization
- Return ONLY the JSON, nothing else

Topic: {input}
"""

# MCQ Quiz Generation Prompts
def get_mcq_quiz_prompt(num_questions: int) -> str:
    return f"""
Create {num_questions} multiple choice questions based on the given content.

Return the questions in this exact format:
- Question 1: [question text]
- Option A: [option text]
- Option B: [option text] 
- Option C: [option text]
- Option D: [option text]
- Correct Answer: [A/B/C/D]
- Explanation: [brief explanation]

- Question 2: [question text]
- Option A: [option text]
- Option B: [option text]
- Option C: [option text]
- Option D: [option text]
- Correct Answer: [A/B/C/D]
- Explanation: [brief explanation]

Continue this pattern for all {num_questions} questions.

IMPORTANT REQUIREMENTS:
- Questions must be clear and relevant to the content
- All options (A, B, C, D) must be plausible but only one correct
- Correct answers should be distributed across A, B, C, D
- Explanations should be helpful and educational
- Use the exact format shown above
"""

# Flashcard Generation Prompts
FLASHCARD_GENERATION_PROMPT = """
You are a flashcard generator. Create educational flashcards based on the given content.

CRITICAL: Return ONLY a valid JSON array. Do not include any other text, explanations, or formatting.

The JSON must follow this exact structure:
[
    {{
        "front": "Question or concept on the front of the card",
        "back": "Answer or explanation on the back of the card",
        "category": "Topic category (e.g., 'Definition', 'Concept', 'Example')",
        "difficulty": "easy|medium|hard"
    }}
]

Requirements:
- Create 10-15 flashcards
- Cover key concepts, definitions, and important points
- Make them suitable for studying and review
- Use clear, concise language
- Return ONLY the JSON array, nothing else

Content: {input}
"""

# Audio Transcription Prompts (if needed for processing)
AUDIO_TRANSCRIPTION_PROCESSING_PROMPT = """
You are an expert at processing and enhancing audio transcripts. 
Clean up the given transcript by:
1. Fixing punctuation and capitalization
2. Removing filler words and repetitions
3. Improving sentence structure
4. Maintaining the original meaning and context
5. Preserving speaker identification if present

Return the cleaned transcript in a clear, readable format.
"""

# Content Analysis Prompts
CONTENT_ANALYSIS_PROMPT = """
Analyze the given content and provide insights on:
1. **Main Topics**: Identify the primary subjects discussed
2. **Key Concepts**: Extract important concepts and definitions
3. **Complexity Level**: Assess the difficulty (beginner/intermediate/advanced)
4. **Learning Objectives**: What can someone learn from this content
5. **Prerequisites**: What background knowledge might be needed
6. **Related Topics**: Suggest related subjects for further study

Return your analysis in a structured format.
"""

# Study Guide Generation Prompts
STUDY_GUIDE_PROMPT = """
Create a comprehensive study guide based on the given content.
Return ONLY a valid JSON object with the following structure:
{{
    "title": "Study Guide Title",
    "overview": "Brief overview of the content",
    "learning_objectives": ["Objective 1", "Objective 2", "Objective 3"],
    "key_concepts": [
        {{
            "concept": "Concept name",
            "definition": "Clear definition",
            "importance": "Why this concept matters"
        }}
    ],
    "main_sections": [
        {{
            "title": "Section title",
            "summary": "Section summary",
            "key_points": ["Point 1", "Point 2", "Point 3"]
        }}
    ],
    "practice_questions": [
        {{
            "question": "Practice question",
            "answer": "Detailed answer"
        }}
    ],
    "resources": ["Additional resource 1", "Additional resource 2"]
}}
"""

# Note Taking Prompts
NOTE_TAKING_PROMPT = """
Transform the given content into well-organized, comprehensive notes.
Structure the notes with:
1. **Main Headers**: Clear section titles
2. **Subpoints**: Important details under each section
3. **Key Terms**: Highlight and define important vocabulary
4. **Examples**: Include relevant examples where helpful
5. **Connections**: Show relationships between concepts
6. **Summary**: Brief recap of main points

Use formatting like:
- Bullet points for lists
- Bold text for key terms
- Indentation for hierarchy
- Clear, concise language
"""

# Quiz Difficulty Assessment Prompts
QUIZ_DIFFICULTY_ASSESSMENT_PROMPT = """
Assess the difficulty level of the given content and suggest appropriate quiz questions.
Consider:
1. **Vocabulary Complexity**: Technical terms and jargon used
2. **Concept Depth**: How deep the content goes into topics
3. **Prerequisites**: Required background knowledge
4. **Abstract Thinking**: Level of critical thinking required

Return a JSON object with:
{{
    "difficulty_level": "beginner|intermediate|advanced",
    "reasoning": "Explanation of difficulty assessment",
    "suggested_question_types": ["multiple_choice", "true_false", "short_answer"],
    "focus_areas": ["Area 1", "Area 2", "Area 3"]
}}
"""

# Content Enhancement Prompts
CONTENT_ENHANCEMENT_PROMPT = """
Enhance the given educational content by:
1. **Adding Examples**: Include practical examples where helpful
2. **Clarifying Concepts**: Make complex ideas more accessible
3. **Adding Context**: Provide background information when needed
4. **Improving Flow**: Ensure logical progression of ideas
5. **Adding Visual Cues**: Suggest where diagrams or charts would help
6. **Including Applications**: Show real-world applications of concepts

Maintain the original tone and style while making the content more engaging and understandable.
"""

# Learning Path Generation Prompts
LEARNING_PATH_PROMPT = """
Create a structured learning path based on the given content.
Return ONLY a valid JSON object with the following structure:
{{
    "title": "Learning Path Title",
    "description": "Overview of the learning journey",
    "estimated_duration": "X hours/days/weeks",
    "prerequisites": ["Prerequisite 1", "Prerequisite 2"],
    "modules": [
        {{
            "title": "Module title",
            "description": "What this module covers",
            "duration": "Estimated time",
            "objectives": ["Objective 1", "Objective 2"],
            "resources": ["Resource 1", "Resource 2"]
        }}
    ],
    "assessment_points": [
        {{
            "type": "quiz|project|discussion",
            "description": "Assessment description"
        }}
    ],
    "next_steps": ["Next learning area 1", "Next learning area 2"]
}}
"""

# ==============================
# New: YouTube URL-based prompts
# ==============================

# Summary from YouTube URL (no transcript). The model should access and analyze the content.
YOUTUBE_URL_SUMMARY_PROMPT = """
You are a professional summarizer. Access and analyze the content at the given YouTube URL and produce a clear, structured summary.

Instructions:
- Do NOT provide a transcript; provide a summary.
- Focus on main ideas, key points, and the central message.
- Be concise but comprehensive.

URL: {input}
"""

# Mindmap JSON from YouTube URL
YOUTUBE_URL_MINDMAP_PROMPT = """
You are a mindmap generator. Access and analyze the content at the given YouTube URL and return ONLY a valid JSON object with this exact structure:
{{
    "name": "Main Topic",
    "children": [
        {{"name": "Subtopic", "children": [{{"name": "Detail"}}]}} 
    ]
}}

Requirements:
- Include 3-5 main subtopics with 2-4 details each
- Use concise names suitable for D3.js tree visualization
- Return ONLY the JSON, nothing else

URL: {input}
"""

# Flashcards JSON array from YouTube URL
YOUTUBE_URL_FLASHCARD_PROMPT = """
You are a flashcard generator. Access and analyze the content at the given YouTube URL and return ONLY a valid JSON array of flashcards with this exact structure:
[
    {{
        "front": "Question or concept",
        "back": "Answer or explanation",
        "category": "Definition|Concept|Example|Process|Fact",
        "difficulty": "easy|medium|hard"
    }}
]

Requirements:
- Create 10-15 flashcards
- Cover key concepts and definitions
- Return ONLY the JSON array, nothing else

URL: {input}
"""

# MCQ JSON from YouTube URL

def get_youtube_url_mcq_prompt(num_questions: int) -> str:
    return f"""
You are an MCQ quiz generator. Access and analyze the content at the given YouTube URL and return questions in this exact format:
- Question 1: [question text]
- Option A: [option text]
- Option B: [option text]
- Option C: [option text]
- Option D: [option text]
- Correct Answer: [A/B/C/D]
- Explanation: [brief explanation]

Continue this pattern for all {num_questions} questions. Be accurate and educational.

URL: {{input}}
""" 