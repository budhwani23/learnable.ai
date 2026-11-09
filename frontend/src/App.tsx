import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import InputSection from "./components/InputSection";
import Input from "./pages/Input";
import ProtectedRoute from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ResourceView from "./pages/ResourceView";
import { LtiBridge, LtiPicker } from "./pages/LtiLaunch";
import { useAuth } from "@/hooks/useAuth";

const queryClient = new QueryClient();

const App = () => {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route
              path="/input"
              element={
                <ProtectedRoute isAuthed={isAuthenticated}>
                  <Input/>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            {/* Shared class resources + LMS (LTI 1.3) launches */}
            <Route path="/r/:id" element={<ResourceView />} />
            <Route path="/lti" element={<LtiBridge />} />
            <Route path="/lti/pick" element={<LtiPicker />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
