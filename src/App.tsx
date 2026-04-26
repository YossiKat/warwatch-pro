import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import DriveMode from "./pages/DriveMode.tsx";
import CarPlayMode from "./pages/CarPlayMode.tsx";
import Register from "./pages/Register.tsx";
import Admin from "./pages/Admin.tsx";
import CommandCenter from "./pages/CommandCenter.tsx";
import Flights from "./pages/Flights.tsx";
import GlobalMonitor from "./pages/GlobalMonitor.tsx";
import GlobalWar from "./pages/GlobalWar.tsx";
import Disasters from "./pages/Disasters.tsx";
import Population from "./pages/Population.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/register" element={<Register />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/drive" element={<DriveMode />} />
          <Route path="/carplay" element={<CarPlayMode />} />
          <Route path="/command" element={<CommandCenter />} />
          <Route path="/flights" element={<Flights />} />
          <Route path="/global" element={<GlobalMonitor />} />
          <Route path="/global-war" element={<GlobalWar />} />
          <Route path="/disasters" element={<Disasters />} />
          <Route path="/population" element={<Population />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
