# 🧠 NeuroDesk — Brain-Inspired Agentic AI Command Center  

NeuroDesk is a **brain-inspired AI platform** that turns natural language user intent into **safe, auditable real-world action**. Instead of just chatting, NeuroDesk **plans, coordinates AI agents, enforces approvals, and logs everything** — acting like a digital decision-making system with human oversight.

At its core, NeuroDesk is an **agentic middleware layer** that bridges conversation and real execution through structured workflows, multi-agent orchestration, and strict guardrails.

---

## 🚀 What NeuroDesk Does  

A user can type a request in plain English such as:  

> “Tell me about my Flow State!”  

NeuroDesk will:

1. **Parse intent** using an LLM  
2. **Break the request into subtasks**  
3. **Route work to specialized agents**  
4. **Pause for approval if something is risky**  
5. **Execute safely with budgets and logs**  
6. **Stream real-time updates to the UI**  

Everything is recorded with a full **audit trail** and **transaction log**, making the system transparent and trustworthy.

---

## 🏗️ Architecture Overview  

### Backend (NEXUS Engine)
Built with **FastAPI**, providing a structured, secure, and scalable core:

- **Intent Parser** (Groq + Gemini fallback)  
- **Multi-Agent Orchestration**  
- **ResearchAgent** – web search, scraping, summarization  
- **CommunicationAgent** – email drafting + sending (approval required)  
- **PurchaseAgent** – product research & recommendations  
- **Budget & Approval System**  
- **PostgreSQL Database + Alembic Migrations**  
- **Redis for caching & rate limiting**  
- **Server-Sent Events (SSE) for real-time updates**  

### Frontend (NeuroDesk UI)
Built with **Next.js + Tambo AI**, acting as the command center:

- Conversational AI interface  
- Task dashboard  
- Live status updates  
- Approval queue  
- Spending tracker  
- Audit activity panel  

Tambo is used as the **tool-calling interface**, converting natural language into structured API requests to the FastAPI backend.

---

## 🛠️ Tech Stack  

**Backend**
- FastAPI  
- PostgreSQL + SQLAlchemy (async)  
- Redis  
- Alembic  
- Groq (Llama 3.1)  
- Google Gemini (fallback)  
- Brave Search API  
- Resend Email API  

**Frontend**
- Next.js  
- TypeScript  
- Tambo AI  
- Tailwind CSS  

**Real-time**
- Server-Sent Events (SSE)

---

## 🎯 Demo Flow  

1. User submits a task in chat  
2. NeuroDesk sends request to backend  
3. Backend creates a task + selects agent  
4. Agent executes work  
5. Results stream live to UI  
6. If approval is required, user must confirm  
7. Everything is logged and stored  

Example demo tasks:
- “Research best laptops under $1000”
- “Draft a professional email summarizing this research”
- “Compare product prices and recommend the best option”

---

## 📂 Repository Structure (High-Level)

neurodesk/
│── frontend/ # Next.js + Tambo UI
│── nexus_backend/ # FastAPI core system
│ ├── app/
│ │ ├── api/
│ │ ├── services/
│ │ ├── agents/
│ │ ├── models/
│ │ └── schemas/
│ ├── alembic/
│ ├── docker-compose.yml
│ └── requirements.txt


---

## 🧾 Key Features  

- Natural language task execution  
- Multi-agent collaboration  
- Human-in-the-loop safety  
- Budget enforcement  
- Approval workflows  
- Real-time status updates  
- Full audit logging  
- Modular, extensible architecture  

---

## 📌 Why NeuroDesk Matters  

Most AI systems **talk**. NeuroDesk **acts — but safely.**  

It demonstrates a practical model for:
- Agentic AI  
- Real-world automation  
- Responsible AI execution  
- Human-AI collaboration  

---

## 🔜 Future Work  

Potential next steps include:
- Real hiring integrations (Upwork/TaskRabbit)  
- Calendar scheduling automation  
- Payment execution layer  
- Contract management  
- Stronger verification mechanisms  
- Better security sandboxing
