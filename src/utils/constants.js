import { newId } from './id'

export const DEFAULT_STAGES = [
  { key: 'lead',        label: 'Lead',        color: 'slate',  order: 0 },
  { key: 'qualified',   label: 'Qualified',   color: 'blue',   order: 1 },
  { key: 'proposal',    label: 'Proposal',    color: 'violet', order: 2 },
  { key: 'negotiation', label: 'Negotiation', color: 'amber',  order: 3 },
  { key: 'closed_won',  label: 'Closed Won',  color: 'green',  order: 4 },
  { key: 'closed_lost', label: 'Closed Lost', color: 'red',    order: 5 },
]

export const STAGE_COLORS = {
  slate:  { bg: 'bg-slate-100',  text: 'text-slate-700',  dot: 'bg-slate-400',  header: 'bg-slate-50',  border: 'border-slate-200' },
  blue:   { bg: 'bg-blue-100',   text: 'text-blue-700',   dot: 'bg-blue-500',   header: 'bg-blue-50',   border: 'border-blue-200'  },
  violet: { bg: 'bg-violet-100', text: 'text-violet-700', dot: 'bg-violet-500', header: 'bg-violet-50', border: 'border-violet-200'},
  amber:  { bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-500',  header: 'bg-amber-50',  border: 'border-amber-200' },
  green:  { bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500',  header: 'bg-green-50',  border: 'border-green-200' },
  red:    { bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500',    header: 'bg-red-50',    border: 'border-red-200'   },
}

const now = new Date().toISOString()

export const SEED_CONTACTS = [
  { id: 'c-001', firstName: 'Sarah',   lastName: 'Johnson',   email: 'sarah.j@acmecorp.com',   phone: '(415) 555-0101', company: 'Acme Corp',        title: 'VP of Engineering',     notes: 'Met at SaaS conference 2024. Very interested in the enterprise tier.',  createdAt: now, updatedAt: now },
  { id: 'c-002', firstName: 'Michael', lastName: 'Chen',      email: 'm.chen@techflow.io',      phone: '(650) 555-0202', company: 'TechFlow',          title: 'CTO',                   notes: 'Referred by Sarah Johnson. Technical buyer.',                           createdAt: now, updatedAt: now },
  { id: 'c-003', firstName: 'Emily',   lastName: 'Rodriguez', email: 'emily@vertexai.co',       phone: '(512) 555-0303', company: 'Vertex AI',         title: 'Head of Procurement',   notes: '',                                                                     createdAt: now, updatedAt: now },
  { id: 'c-004', firstName: 'David',   lastName: 'Park',      email: 'd.park@globalops.com',    phone: '(212) 555-0404', company: 'GlobalOps',         title: 'Director of Operations',notes: 'Interested in the enterprise plan. Needs approval from CFO.',          createdAt: now, updatedAt: now },
  { id: 'c-005', firstName: 'Lisa',    lastName: 'Thompson',  email: 'lisa.t@brightwave.com',   phone: '(310) 555-0505', company: 'Brightwave',        title: 'CEO',                   notes: 'Decision maker. Needs Q1 start date.',                                 createdAt: now, updatedAt: now },
  { id: 'c-006', firstName: 'James',   lastName: 'Wilson',    email: 'jwilson@nexgensol.co',    phone: '(617) 555-0606', company: 'NexGen Solutions',  title: 'CFO',                   notes: '',                                                                     createdAt: now, updatedAt: now },
  { id: 'c-007', firstName: 'Priya',   lastName: 'Patel',     email: 'priya@cloudbase.dev',     phone: '(408) 555-0707', company: 'Cloudbase',         title: 'Engineering Manager',   notes: 'Follow up after product demo.',                                        createdAt: now, updatedAt: now },
]

export const SEED_DEALS = [
  { id: 'd-001', title: 'Acme Corp Enterprise',      value: 8500000,  stage: 'negotiation', contactId: 'c-001', closeDate: '2026-04-30', probability: 80, notes: 'Contract review in progress. Legal flagged two clauses.', createdAt: now, updatedAt: now },
  { id: 'd-002', title: 'TechFlow Platform License',  value: 3200000,  stage: 'proposal',    contactId: 'c-002', closeDate: '2026-05-15', probability: 60, notes: 'Sent proposal v2. Awaiting feedback.',                    createdAt: now, updatedAt: now },
  { id: 'd-003', title: 'Vertex AI Integration',      value: 1500000,  stage: 'qualified',   contactId: 'c-003', closeDate: '2026-06-01', probability: 40, notes: '',                                                       createdAt: now, updatedAt: now },
  { id: 'd-004', title: 'GlobalOps Expansion',        value: 5000000,  stage: 'lead',        contactId: 'c-004', closeDate: '2026-07-31', probability: 20, notes: 'Initial discovery call scheduled for next week.',         createdAt: now, updatedAt: now },
  { id: 'd-005', title: 'Brightwave Starter',         value: 2800000,  stage: 'closed_won',  contactId: 'c-005', closeDate: '2026-03-15', probability: 100,notes: 'Contract signed! Kickoff March 20.',                      createdAt: now, updatedAt: now },
  { id: 'd-006', title: 'NexGen Pilot Program',       value: 750000,   stage: 'closed_lost', contactId: 'c-006', closeDate: '2026-03-01', probability: 0,  notes: 'Went with competitor. Price sensitive.',                  createdAt: now, updatedAt: now },
  { id: 'd-007', title: 'Acme Corp — Add-on Module',  value: 1200000,  stage: 'lead',        contactId: 'c-001', closeDate: '2026-08-31', probability: 15, notes: '',                                                       createdAt: now, updatedAt: now },
  { id: 'd-008', title: 'Cloudbase Growth Plan',      value: 960000,   stage: 'qualified',   contactId: 'c-007', closeDate: '2026-06-15', probability: 35, notes: 'Demo went well. Scheduling follow-up.',                  createdAt: now, updatedAt: now },
]
