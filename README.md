# 🎾 Tennis Ladder System

A comprehensive, ladder system for tennis leagues, built with Node.js, Express, MongoDB, and Resend email service. Designed for volunteer-run sports clubs.

> **⚠️ Important**: This is a non-profit system run by volunteers. Respect and fair play at all times are essential to participate as an active user.

---

## 📋 Table of Contents

1. [Features](#features)
2. [Tech Stack](#tech-stack)
3. [Prerequisites](#prerequisites)
4. [Installation & Setup](#installation--setup)
5. [Environment Variables](#environment-variables)
6. [Database Schema](#database-schema)
7. [API Documentation](#api-documentation)
8. [Running Locally](#running-locally)
9. [Deployment](#deployment)
10. [Weekly Job System](#weekly-job-system)
11. [Rules & Policies](#rules--policies)
12. [Troubleshooting](#troubleshooting)

---

## ✨ Features

### Core System
- ✅ **User Registration & Profiles** - ITN-based rating scale (10.0 = beginner, 3.0 = professional)
- ✅ **Match Assignment Engine** - Intelligent weekly pairing based on ratings and frequency
- ✅ **Scheduling System** - 48-hour proposal/counter-proposal negotiation with auto-cancel
- ✅ **Score Submission** - Player submissions with resubmission tracking and dispute resolution
- ✅ **Rating Algorithm** - Elo-based system adapted for 10.0–3.0 scale with game margin amplification
- ✅ **Ranking System** - Weekly updates with hard floor at 4.0 rating

### Seasons & Calendar
- ✅ **52-Week Year Structure** - 4 seasons × 12 weeks + 4 breaks (one at Christmas)
- ✅ **ISO Week Mapping** - Handles week 52/53 edge cases
- ✅ **Current Week Display** - UI shows "Summer League - Week 1 of 12"
- ✅ **Season-Based Eligibility** - Late registrations (last 2 weeks) excluded from podium

### Admin & Moderation
- ✅ **Dispute Mediation** - Accept submission, set custom score, or cancel match
- ✅ **Account Freezing** - 3-week freeze for 3 consecutive cancellations
- ✅ **User Flagging** - Flag inappropriate behavior; excluded from assignments
- ✅ **Audit Logs** - All actions tracked with timestamps and submitter identity

### User Experience
- ✅ **Cancellation Penalties** - Rating +0.1, tracked toward 3-strike freeze
- ✅ **Pause Participation** - Temporarily step out; ranking drops weekly by 1 position min.
- ✅ **Default Avatar** - Initials-based (e.g., "JF" for Jane Fonda) with gender-based colors
- ✅ **Amsterdam Timezone** - Current time/date displayed throughout UI
- ✅ **Mobile-First UI** - Optimized for phone-based scheduling and match management
- ✅ **End-of-Season Podiums** - General and gender-specific top-3 images with auto-generation
- ✅ **Social Sharing** - Share results without exposing surnames, membership numbers, or contact info

### Email & Notifications
- ✅ **Immediate Alerts** - Score submissions, proposals, acceptances, cancellations
- ✅ **Batch Emails** - Daily digest option; opt-out for non-essential emails
- ✅ **Season-End Reports** - Auto-generated with ratings, rankings, and podium images
- ✅ **Admin Alerts** - Disputes, frozen accounts, and weekly job status

---

## 🛠 Tech Stack

| Component | Technology |
|-----------|-----------|
| **Backend** | Node.js + Express.js |
| **Database** | MongoDB Atlas (free tier M0) |
| **Email Service** | Resend |
| **Authentication** | JWT (JSON Web Tokens) |
| **Task Scheduler** | node-cron |
| **Image Generation** | SVG (podium images) |
| **Deployment** | Render.com (free tier) |

---

## 📋 Prerequisites

Before you start, ensure you have:

- ✅ **GitHub Account** - https://github.com
- ✅ **Node.js (v14+)** - https://nodejs.org (LTS recommended)
- ✅ **Git** - https://git-scm.com
- ✅ **MongoDB Atlas Account** - https://cloud.mongodb.com (free tier)
- ✅ **Resend Account** - https://resend.com (free tier, up to 100 e-mails per day. Usually suitable for groups of max 50 active users)

---

## 🚀 Installation & Setup

### Step 1: Clone the Repository

```bash
git clone https://github.com/n9user/tennisladder.git
cd tennisladder
git checkout develop
