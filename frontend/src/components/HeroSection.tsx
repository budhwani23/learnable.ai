import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight, Video, Headphones, Target, Menu,
  X,
  Upload,
  Wand2,
  BookOpen,
  Brain,
  Map,
  FileText,
  Share2,
  Download,
  Check,
  Star,
  Zap,
  Heart, } from "lucide-react";
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useState } from 'react';

const HeroSection = () => {
  const features = [
    {
      icon: FileText,
      title: "Drop Content",
      description: "Upload video, audio, or text - we handle the rest!"
    },
    {
      icon: Target,
      title: "AI Transforms",
      description: "Generate MCQs, true/false, and fill-in-the-blank questions"
    },
    {
      icon: BookOpen,
      title: "Digital Flashcards",
      description: "Create memorable flashcards for effective studying"
    },
    {
      icon: Brain,
      title: "Mind Maps",
      description: "Visualize concepts with hierarchical mind maps"
    }
  ];

  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  function onStart() {
    const target = '/input';
    if (isAuthenticated) navigate(target);
    else navigate(`/login?redirect=${encodeURIComponent(target)}`);
  }

  return (
    <section className="pt-28 bg-green-50">
      <div className="container mx-auto px-4">
        {/* Hero Section with Mascot */}
        <div className="grid lg:grid-cols-2 gap-12 mb-16 items-center">
          {/* Left Content */}
          <div className="justify-items-start text-left py-6">
            <div className="inline-flex bg-green-100 px-3 gap-2 bg-muted/50 rounded-full py-2 mb-6">
              {/* <Zap className="h-4 w-4 text-accent" /> */}
              {/* <span className="text-sm font-medium text-muted-foreground">Powered by Google Gemini AI</span> */}
            </div>
            
            <h1 className="text-4xl md:text-6xl font-bold mb-6 text-emerald-600">
              Transform Any Content Into
              <br />
              <span className="text-foreground">Learning Resources</span>
            </h1>
            
            <p className="text-base md:text-xl text-muted-foreground mb-8 max-w-2xl">
              Upload videos, audio, or text and instantly generate summaries, quizzes, flashcards, and mind maps using advanced AI technology.
            </p>
            
            <div className="w-full flex flex-col sm:flex-row gap-4 justify-start items-start">
              <Button
                size="lg"
                className="text-lg font-semibold text-white bg-emerald-600 rounded-3xl hover:bg-emerald-500"
                onClick={onStart}
              >
                <span className="flex items-center gap-2">
                  Start Learning Now
                  <ArrowRight className="h-5 w-5" />
                </span>
              </Button>

              <Button
                size="lg"
                className="text-lg font-semibold hover:bg-emerald-600 hover:text-white text-emerald-600 border-emerald-600 rounded-3xl border-2 px-8"
                onClick={() => scrollTo('how-it-works')}
              >
                <Video className="h-5 w-5" />
                See How It Works
              </Button>
            </div>
          </div>

          {/* Right Content - Mascot */}
          <div className="flex justify-center lg:justify-end ">
            <div className="relative group">
              <img 
                src="/Landing-page-3.png" 
                alt="Hopnote Superhero Mascot" 
                className="w-full max-w-[400px] max-h-[800px] object-contain animate-bounce-subtle"
              />
              {/* Add some floating elements around the mascot */}
              <div className="absolute top-10 -left-6 animate-pulse">
              {/*}  <div className="bg-emerald-500 text-white px-3 py-1 rounded-full text-sm font-semibold shadow-lg">
                
                </div>*/}
              </div>
              <div className="absolute bottom-16 -right-8 animate-pulse delay-1000">
              {/*<div className="bg-blue-500 text-white px-3 py-1 rounded-full text-sm font-semibold shadow-lg">
                  
                </div>*/}
              </div>
            </div>
          </div>
        </div>

        {/* How It Works Section */}
        <section id="how-it-works" className="py-16 md:py-24 bg-green-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16 fade-in-on-scroll">
              <h2 className="text-3xl md:text-4xl font-bold text-[#1B1B1B] mb-4">How It Works</h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Three simple steps to transform your learning experience
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 items-stretch">
              {[
                {
                  step: "01",
                  title: "Drop Content",
                  icon: Upload,
                  desc: "Upload video, audio, or text - we handle the rest!",
                  chips: ["Video", "Audio", "Text"],
                  gradient: "from-emerald-200/70 via-green-100/60 to-lime-100/70",
                  iconBg: "bg-emerald-600"
                },
                {
                  step: "02",
                  title: "AI Transforms",
                  icon: Wand2,
                  desc: "Get flashcards, quizzes, and mind maps instantly",
                  chips: ["Flashcards", "Quizzes", "Mindmaps"],
                  gradient: "from-green-200/70 via-emerald-100/60 to-teal-100/70",
                  iconBg: "bg-emerald-600"
                },
                {
                  step: "03",
                  title: "You Study",
                  icon: BookOpen,
                  desc: "Use your favorite learning format and ace those tests",
                  chips: ["Spaced", "Practice", "Review"],
                  gradient: "from-teal-200/70 via-cyan-100/60 to-emerald-100/70",
                  iconBg: "bg-emerald-600"
                },
              ].map((item, index) => (
                <div key={index} className="group relative h-full">
                  <div className={`rounded-2xl p-[1px] bg-gradient-to-br ${item.gradient} shadow-[0_10px_30px_-10px_rgba(16,185,129,0.35)] h-full transition-all duration-300 group-hover:-translate-y-2 group-hover:-rotate-1 group-hover:shadow-[0_20px_60px_-20px_rgba(16,185,129,0.45)]`}>
                    <div className="rounded-2xl bg-white/90 backdrop-blur-sm h-full flex flex-col transition-shadow duration-300 group-hover:shadow-lg">
                      <div className="p-6 md:p-7 flex-1">
                        <div className="flex items-start gap-4">
                          <div className={`w-14 h-14 rounded-full ${item.iconBg} flex items-center justify-center text-white shadow-md transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}> 
                            <item.icon className="w-7 h-7" />
                          </div>
                          <div>
                            <div className="text-[11px] font-bold tracking-widest text-emerald-600/70">{item.step}</div>
                            <h3 className="text-xl font-bold text-[#1B1B1B] mt-1 transition-colors duration-300 group-hover:text-emerald-700">{item.title}</h3>
                          </div>
                        </div>
                        <p className="text-gray-600 mt-4 text-sm">{item.desc}</p>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {item.chips.map((chip, cIdx) => (
                            <span key={cIdx} className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 transform transition-all duration-300 opacity-80 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0" style={{ transitionDelay: `${cIdx * 60}ms` }}>
                              {chip}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="px-6 py-3 rounded-b-2xl bg-gradient-to-r from-emerald-50 to-green-50 text-[10px] tracking-wider text-gray-500 uppercase transition-colors duration-300 group-hover:from-emerald-100 group-hover:to-green-100">
                        Simple • Fast • Effective
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-16 md:py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16 fade-in-on-scroll">
              <h2 className="text-3xl md:text-4xl font-bold text-[#1B1B1B] mb-4">Everything You Need to Study Smart</h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">Powerful features designed for the modern learner</p>
            </div>

            <div className="hidden md:flex items-end justify-center relative select-none" onMouseLeave={() => setHoveredIndex(null)}>
              {[
                { icon: Brain, title: "Smart Flashcards", desc: "AI-generated cards that adapt to your learning style", bg: "bg-lime-100", txt: "text-[#1B1B1B]", rotate: "-rotate-6", angle: -6, accent: "bg-lime-700/40", icn: "text-lime-700" },
                { icon: Map, title: "Mind Maps", desc: "Visual connections that make complex topics simple", bg: "bg-emerald-100", txt: "text-[#1B1B1B]", rotate: "-rotate-3", angle: -3, accent: "bg-emerald-700/40", icn: "text-emerald-700" },
                { icon: FileText, title: "Interactive Quizzes", desc: "Test yourself with personalized questions", bg: "bg-teal-100", txt: "text-[#1B1B1B]", rotate: "rotate-0", angle: 0, accent: "bg-teal-700/40", icn: "text-teal-700" },
                { icon: Upload, title: "Multimodal Input", desc: "Upload videos, audio, PDFs, or text", bg: "bg-cyan-100", txt: "text-[#1B1B1B]", rotate: "rotate-3", angle: 3, accent: "bg-cyan-700/40", icn: "text-cyan-700" },
                { icon: Share2, title: "Easy Sharing", desc: "Collaborate with classmates and study groups", bg: "bg-sky-100", txt: "text-[#1B1B1B]", rotate: "rotate-6", angle: 6, accent: "bg-sky-700/40", icn: "text-sky-700" },
              ].map((feature, index) => {
                const isHovered = hoveredIndex === index;
                const distance = hoveredIndex !== null ? index - (hoveredIndex as number) : 0;
                const translateX = hoveredIndex !== null && !isHovered ? distance * 28 : 0;
                const scale = hoveredIndex !== null ? (isHovered ? 1.06 : 0.94) : 1;
                const rotateDeg = hoveredIndex !== null ? (isHovered ? 0 : feature.angle) : feature.angle;
                const translateY = isHovered ? -8 : 0;
                const transformValue = `translateX(${translateX}px) translateY(${translateY}px) rotate(${rotateDeg}deg) scale(${scale})`;
                return (
                  <div
                    key={index}
                    className={`group relative -ml-10 first:ml-0 transition-transform duration-300 ease-out`}
                    style={{ zIndex: isHovered ? 100 : 10 + index, transform: transformValue }}
                    onMouseEnter={() => setHoveredIndex(index)}
                  >
                    <Card className={`w-64 h-[360px] p-6 shadow-xl border-0 ${feature.bg} ${feature.txt} cursor-pointer`}> 
                      <feature.icon className={`w-8 h-8 mb-3 opacity-90 ${feature.icn}`} />
                      <h3 className="text-2xl font-extrabold mb-2">{feature.title}</h3>
                      <div className={`h-[2px] w-16 ${feature.accent} my-4 transition-all duration-300 group-hover:w-24`} />
                      <p className="text-sm opacity-80">{feature.desc}</p>
                    </Card>
                  </div>
                );
              })}
            </div>

            <div className="md:hidden grid grid-cols-2 gap-4">
              {[
                { icon: Brain, title: "Smart Flashcards", desc: "AI-generated cards that adapt to your learning style", bg: "bg-lime-100", txt: "text-[#1B1B1B]", icn: "text-lime-700" },
                { icon: Map, title: "Mind Maps", desc: "Visual connections that make complex topics simple", bg: "bg-emerald-100", txt: "text-[#1B1B1B]", icn: "text-emerald-700" },
                { icon: FileText, title: "Interactive Quizzes", desc: "Test yourself with personalized questions", bg: "bg-teal-100", txt: "text-[#1B1B1B]", icn: "text-teal-700" },
                { icon: Upload, title: "Multimodal Input", desc: "Upload videos, audio, PDFs, or text", bg: "bg-cyan-100", txt: "text-[#1B1B1B]", icn: "text-cyan-700" },
                { icon: Share2, title: "Easy Sharing", desc: "Collaborate with classmates and study groups", bg: "bg-sky-100", txt: "text-[#1B1B1B]", icn: "text-sky-700" },
                { icon: Download, title: "Export Anywhere", desc: "Take your study materials wherever you go", bg: "bg-green-50", txt: "text-[#1B1B1B]", icn: "text-green-700" },
              ].map((feature, index) => (
                <Card
                  key={index}
                  className={`p-5 shadow-md border-0 ${feature.bg} ${feature.txt} transition-transform duration-300 hover:-translate-y-1`}
                >
                  <feature.icon className={`w-7 h-7 mb-3 opacity-90 ${feature.icn}`} />
                  <h3 className="text-base font-bold mb-1">{feature.title}</h3>
                  <p className="text-xs opacity-80">{feature.desc}</p>
                </Card>
              ))}
            </div>

            <div className="fixed bottom-8 right-8 z-40 hidden lg:block">
            </div>
          </div>
        </section>
        
        {/* Study Struggle Section */}
        <section className="py-16 bg-green-50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 fade-in-on-scroll">
              <h2 className="text-2xl md:text-3xl font-bold text-[#1B1B1B] mb-4">The Study Struggle is Real 😅</h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                A modern twist on an old tale - why slow and steady wins in the age of social media
              </p>
            </div>

            <div className="relative fade-in-on-scroll">
              <div className="bg-white rounded-2xl shadow-lg px-4 md:px-6 py-4 w-fit mx-auto overflow-hidden">
                {/*image placeholder - you can add your comic/illustration here*/}
                <img src="/meme.png" alt="Hopnote Mascot" className="block w-104 h-80 md:w-[40rem] md:h-[28rem] object-contain" />
              </div>
              <div className="mt-6 text-center">
                <p className="text-sm md:text-base font-bold text-[#1B1B1B] bg-green-200 inline-block px-4 py-2 rounded-full">
                  📚 Moral: Focus on learning, not the drama! 💯
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
      
      {/* CTA Section with Mascot */}
      <section className="py-16 md:py-24 bg-green-100 w-full">
        <div className="w-full px-4 sm:px-6 lg:px-8 text-center">
          <div className="fade-in-on-scroll">
            <div className="flex justify-center mb-6">
              {/* <img 
                src="https://page.gensparksite.com/v1/base64_upload/b52f64b0395f7ab5389890c2946d7cd0" 
                alt="Hopnote Mascot" 
                className="w-16 h-16 object-contain"
              /> */}
              <img src="/hopenote-logo.png" alt="Hopnote Mascot" className="w-16 h-16 object-contain" />
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-[#1B1B1B] mb-6">
              Ready to Transform Your Learning?
            </h2>
            <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
              Join thousands of students who are already learning smarter with Hopnote. Your future self will thank you! 🎓
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" className="bg-emerald-600 hover:bg-emerald-500 text-white text-lg px-8 py-3 rounded-full" onClick={onStart}>
                Start Your Journey <Heart className="w-5 h-5 ml-2" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-600 hover:text-white text-lg px-8 py-3 rounded-full bg-transparent"
                onClick={() => scrollTo('features')}
              >
                Learn More
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#1B1B1B] text-white py-12 w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <img src="/hopenote-logo.png" alt="Hopnote" className="w-8 h-8 rounded-full object-contain" />
                <span className="text-xl font-bold">Hopnote</span>
              </div>
              <p className="text-gray-400 text-sm">
                Learn smarter, not harder. Transform your study experience with AI.
              </p>
            </div>
            <div>
              <h4 className="font-bold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-green-400">Features</a></li>
                <li><a href="#" className="hover:text-green-400">Pricing</a></li>
                <li><a href="#" className="hover:text-green-400">API</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-green-400">About</a></li>
                <li><a href="#" className="hover:text-green-400">Blog</a></li>
                <li><a href="#" className="hover:text-green-400">Careers</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Support</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-green-400">Help Center</a></li>
                <li><a href="#" className="hover:text-green-400">Contact</a></li>
                <li><a href="#" className="hover:text-green-400">Privacy</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
            <p>&copy; 2024 Hopnote. All rights reserved. Made with ❤️ for learners everywhere.</p>
          </div>
        </div>
      </footer>  
    </section>
  );
};

export default HeroSection;
