"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { addDays, format, parse } from 'date-fns'
import { v4 as uuidv4 } from 'uuid';
import {
  Briefcase, Calendar, CheckSquare, Clock, Coffee, Copy, Download, Moon, Plus, RotateCcw, Save, Sun, Trash2, Utensils
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { useLocalStorage } from "@/lib/hooks/use-local-storage"
import { generateSchedule } from "@/lib/scheduler"
import type { LiveAppState, ScheduleDay, ScheduleSummary, Settings, Skill, ScheduleBlock } from "@/lib/types"
import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"

const skillSchema = z.object({
  name: z.string().min(1, "Skill name is required."),
  priority: z.enum(["High", "Medium", "Low"]),
  estHours: z.coerce.number().min(0.1, "Hours must be positive."),
});

const settingsSchema = z.object({
  mode: z.enum(["Daily", "Monthly"]),
  dailyHours: z.coerce.number().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid time format (HH:MM)"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid time format (HH:MM)"),
  workBlockMins: z.coerce.number().min(25, "Work block must be at least 25 minutes."),
  breakMins: z.coerce.number().min(0),
  lunchEnabled: z.boolean(),
  lunchStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid time format (HH:MM)").optional(),
  lunchDuration: z.coerce.number().min(1).optional(),
}).superRefine((data, ctx) => {
  if (data.mode === 'Daily' && (data.dailyHours === undefined || data.dailyHours <= 0)) {
    ctx.addIssue({ code: "custom", path: ["dailyHours"], message: "Daily hours are required for Daily mode." });
  }
  if (data.mode === 'Monthly') {
    if (!data.startDate || !data.endDate) {
      ctx.addIssue({ code: "custom", path: ["startDate"], message: "Start and end dates are required for Monthly mode." });
    } else if (new Date(data.startDate) > new Date(data.endDate)) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after start date." });
    }
  }
  if (data.lunchEnabled) {
    if (!data.lunchStart) ctx.addIssue({ code: "custom", path: ["lunchStart"], message: "Lunch start time is required." });
    if (!data.lunchDuration) ctx.addIssue({ code: "custom", path: ["lunchDuration"], message: "Lunch duration is required." });
  }
});


const today = new Date();
const defaultAppState: LiveAppState = {
  skills: [],
  settings: {
    mode: "Daily",
    dailyHours: 6,
    startDate: format(today, 'yyyy-MM-dd'),
    endDate: format(addDays(today, 29), 'yyyy-MM-dd'),
    startTime: "09:00",
    endTime: "17:00",
    workBlockMins: 50,
    breakMins: 10,
    lunch: { start: "13:00", duration: 60 }
  },
  schedule: null,
  summary: null,
  live: {
    time: format(new Date(), 'HH:mm:ss'),
    date: format(new Date(), 'yyyy-MM-dd'),
    currentStation: "Not Started"
  }
};

const defaultSkills: Omit<Skill, 'id'>[] = [
    { name: "Python", priority: "High", estHours: 20 },
    { name: "Java", priority: "High", estHours: 25 },
    { name: "C Programming", priority: "Medium", estHours: 15 },
    { name: "C++", priority: "Medium", estHours: 20 },
    { name: "SQL", priority: "High", estHours: 10 },
    { name: "Aptitude", priority: "Medium", estHours: 12 },
    { name: "3D Modeling", priority: "Low", estHours: 18 },
    { name: "JavaScript", priority: "High", estHours: 22 },
    { name: "React", priority: "High", estHours: 16 },
    { name: "Node.js", priority: "Medium", estHours: 14 },
    { name: "HTML/CSS", priority: "Medium", estHours: 10 },
    { name: "Data Structures", priority: "High", estHours: 30 },
];


export default function SkillPlanPage() {
  const { toast } = useToast()
  const [appState, setAppState] = useLocalStorage<LiveAppState>('skillScheduler:v2:live', defaultAppState);
  const [isClient, setIsClient] = React.useState(false)
  const [showPopularSkills, setShowPopularSkills] = React.useState(true);


  React.useEffect(() => {
    setIsClient(true)
    const timer = setInterval(() => {
      const now = new Date();
      const liveTime = format(now, 'HH:mm:ss');
      const liveDate = format(now, 'yyyy-MM-dd');

      setAppState(prev => {
        if (!prev.schedule) {
          return { ...prev, live: { ...prev.live, time: liveTime, date: liveDate, currentStation: "Not Started" } };
        }

        let newCurrentStation = "Day Ended";
        let hasChanged = false;

        const currentDaySchedule = prev.schedule.find(day => day.date === liveDate);
        if (currentDaySchedule) {
            for (const block of currentDaySchedule.blocks) {
                if (liveTime >= block.start && liveTime <= block.end) {
                    newCurrentStation = block.skillName || (block.type.charAt(0).toUpperCase() + block.type.slice(1));
                    break; 
                }
            }
        }
        
        const newSchedule = prev.schedule.map(day => {
          if (day.date === liveDate) {
            const newBlocks = day.blocks.map(block => {
              if (block.type === 'work' && !block.completed && block.end <= liveTime) {
                hasChanged = true;
                return { ...block, completed: true };
              }
              return block;
            });

            if (hasChanged) {
              return { ...day, blocks: newBlocks };
            }
          }
          return day;
        });

        if (liveTime < prev.settings.startTime) {
            newCurrentStation = "Not Started";
        }


        return {
          ...prev,
          live: { time: liveTime, date: liveDate, currentStation: newCurrentStation },
          schedule: hasChanged ? newSchedule : prev.schedule,
        };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [setAppState]);

  const skillForm = useForm({
    resolver: zodResolver(skillSchema),
    defaultValues: { name: "", priority: "Medium" as const, estHours: 10 },
  });

  const settingsForm = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      ...appState.settings,
      lunchEnabled: !!appState.settings.lunch,
      lunchStart: appState.settings.lunch?.start || "13:00",
      lunchDuration: appState.settings.lunch?.duration || 60,
    },
  });

  const watchMode = settingsForm.watch('mode');
  const watchLunchEnabled = settingsForm.watch('lunchEnabled');
  
  React.useEffect(() => {
    if (isClient) {
      settingsForm.reset({
        ...appState.settings,
        lunchEnabled: !!appState.settings.lunch,
        lunchStart: appState.settings.lunch?.start || "13:00",
        lunchDuration: appState.settings.lunch?.duration || 60,
      })
    }
  }, [isClient, appState.settings, settingsForm]);

  const addSkill = (values: Omit<Skill, 'id'>) => {
    const newSkill: Skill = { ...values, id: uuidv4() };

    if (appState.skills.some(s => s.name.toLowerCase() === newSkill.name.toLowerCase())) {
        toast({ variant: "destructive", title: "Duplicate Skill", description: "A skill with this name already exists." });
        return;
    }

    setAppState(prev => ({ ...prev, skills: [...prev.skills, newSkill] }));
    
    if (values.name === skillForm.getValues('name')) {
      skillForm.reset();
    }
  };

  const removeSkill = (id: string) => {
    setAppState(prev => ({ ...prev, skills: prev.skills.filter(s => s.id !== id) }));
  };
  
  const handleGenerate = (values: z.infer<typeof settingsSchema>) => {
    if (appState.skills.length === 0) {
      toast({ variant: "destructive", title: "No Skills", description: "Please add at least one skill to generate a schedule." });
      return;
    }

    const currentSettings: Settings = {
      ...values,
      lunch: values.lunchEnabled ? { start: values.lunchStart!, duration: values.lunchDuration! } : null,
    };
    
    try {
      const { schedule: newSchedule, summary: newSummary } = generateSchedule(appState.skills, currentSettings);
      setAppState(prev => ({ ...prev, settings: currentSettings, schedule: newSchedule, summary: newSummary }));
      toast({ title: "Schedule Generated", description: "Your new learning plan is ready!" });
    } catch (error) {
        if (error instanceof Error) {
            toast({ variant: "destructive", title: "Generation Failed", description: error.message });
        }
    }
  };

  const handleReset = () => {
    setAppState(defaultAppState);
    skillForm.reset();
    settingsForm.reset({
        ...defaultAppState.settings,
        lunchEnabled: !!defaultAppState.settings.lunch,
        lunchStart: defaultAppState.settings.lunch?.start || "13:00",
        lunchDuration: defaultAppState.settings.lunch?.duration || 60,
    });
    toast({ title: "Reset Successful", description: "All settings and skills have been reset to default." });
  };

  const handleCopyJson = () => {
    if (!appState.schedule) {
      toast({ variant: "destructive", title: "No Schedule", description: "Generate a schedule first before copying." });
      return;
    }
    navigator.clipboard.writeText(JSON.stringify(appState, null, 2));
    toast({ title: "Copied to Clipboard", description: "Schedule JSON has been copied." });
  };
  
  const handlePrint = () => {
    if (!appState.schedule) {
        toast({ variant: "destructive", title: "No Schedule", description: "Generate a schedule first before printing." });
        return;
    }
    window.print();
  }

  const toggleTaskCompletion = (dayDate: string, blockId: string) => {
    setAppState(prev => {
        if (!prev.schedule) return prev;
        const newSchedule = prev.schedule.map(day => {
            if (day.date === dayDate) {
                return {
                    ...day,
                    blocks: day.blocks.map(block => {
                        if (block.id === blockId && block.type === 'work') {
                            return { ...block, completed: !block.completed };
                        }
                        return block;
                    })
                };
            }
            return day;
        });
        return { ...prev, schedule: newSchedule };
    });
  };
  
  const getProgress = () => {
    if (!isClient || !appState.live) return 0;
    const dayStart = parse(appState.settings.startTime, 'HH:mm', new Date());
    const dayEnd = parse(appState.settings.endTime, 'HH:mm', new Date());
    const now = parse(appState.live.time, 'HH:mm:ss', new Date());

    const totalSeconds = dayEnd.getTime() - dayStart.getTime();
    let elapsedSeconds = now.getTime() - dayStart.getTime();
    
    if (totalSeconds <= 0) return 0;
    if (elapsedSeconds < 0) return 0;
    if (elapsedSeconds > totalSeconds) return 100;

    return (elapsedSeconds / totalSeconds) * 100;
  }

  const getIconForBlock = (type: ScheduleBlock['type']) => {
    switch(type) {
      case 'work': return <Briefcase className="w-4 h-4 text-primary" />;
      case 'break': return <Coffee className="w-4 h-4 text-secondary-foreground/80" />;
      case 'lunch': return <Utensils className="w-4 h-4 text-accent" />;
      case 'buffer': return <Clock className="w-4 h-4 text-muted-foreground" />;
      default: return null;
    }
  }

  const getTaskStatus = (block: ScheduleBlock, day: ScheduleDay): { text: string; color: string } => {
    if (!isClient || !appState.live) return { text: '', color: '' };
    if (block.type !== 'work') return { text: '', color: '' };

    if (block.completed) return { text: 'Completed', color: 'text-green-600 dark:text-green-500' };

    const isToday = day.date === appState.live.date;
    if (!isToday) {
        return (day.date < appState.live.date) 
            ? { text: 'Completed', color: 'text-green-600 dark:text-green-500' }
            : { text: 'Upcoming', color: 'text-gray-500 dark:text-gray-400' };
    }

    if (appState.live.time < block.start) return { text: 'Upcoming', color: 'text-gray-500 dark:text-gray-400' };
    if (appState.live.time >= block.start && appState.live.time <= block.end) return { text: 'In Progress', color: 'text-blue-600 dark:text-blue-500' };
    
    // This case is handled by the useEffect that auto-completes tasks, but as a fallback:
    if (appState.live.time > block.end) return { text: 'Completed', color: 'text-green-600 dark:text-green-500' };
    
    return { text: 'Pending', color: 'text-yellow-600 dark:text-yellow-500' };
  };

  const todayDateStr = format(new Date(), 'yyyy-MM-dd');
  const defaultTab = appState.schedule?.find(d => d.date === todayDateStr)?.date || appState.schedule?.[0]?.date;
  
  if (!isClient) {
    return null; // or a loading spinner
  }
  
  return (
    <div className="min-h-screen bg-background font-body text-foreground">
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 no-print">
        <div className="container flex h-auto min-h-14 flex-col md:flex-row md:items-center py-2">
          <div className="flex justify-between items-center w-full">
            <div className="flex items-center">
              <Calendar className="h-6 w-6 mr-2 text-primary" />
              <span className="font-bold text-lg">SkillPlan</span>
            </div>
            <div className="flex items-center space-x-4">
              <div className="md:hidden font-mono text-sm font-semibold bg-muted px-3 py-1 rounded-lg">
                {isClient && appState.live?.time}
              </div>
              <ThemeToggle />
            </div>
          </div>
          
          <div className="flex-1 flex justify-center items-center mt-2 md:mt-0 md:absolute md:left-1/2 md:-translate-x-1/2">
            {isClient && appState.live && appState.schedule && (
              <div className="flex items-center gap-2 text-center">
                  <span className="font-semibold text-sm text-muted-foreground">Current:</span>
                  <Badge variant="outline" className="font-semibold text-base text-center">{appState.live.currentStation}</Badge>
              </div>
            )}
          </div>

          <div className="hidden md:flex flex-1 items-center justify-end">
             {isClient && appState.live && (
                <div className="font-mono text-lg font-semibold bg-muted px-4 py-1 rounded-lg">
                  {appState.live.time}
                </div>
              )}
           </div>

        </div>
      </header>


      <main className="container py-8 print-container">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-1 flex flex-col gap-8 no-print">
            
            <Card>
              <CardHeader>
                <CardTitle>1. Add Your Skills</CardTitle>
                <CardDescription>List the skills you want to learn, their priority, and estimated hours to master.</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...skillForm}>
                  <form onSubmit={skillForm.handleSubmit(addSkill)} className="space-y-4">
                    <FormField name="name" control={skillForm.control} render={({ field }) => (
                      <FormItem><FormLabel>Skill Name</FormLabel><FormControl><Input placeholder="e.g., Python" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField name="priority" control={skillForm.control} render={({ field }) => (
                        <FormItem><FormLabel>Priority</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger></FormControl><SelectContent><SelectItem value="High">High</SelectItem><SelectItem value="Medium">Medium</SelectItem><SelectItem value="Low">Low</SelectItem></SelectContent></Select><FormMessage /></FormItem>
                      )} />
                      <FormField name="estHours" control={skillForm.control} render={({ field }) => (
                        <FormItem><FormLabel>Est. Hours</FormLabel><FormControl><Input type="number" step="0.5" placeholder="e.g., 20" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                    <Button type="submit" className="w-full"><Plus className="mr-2 h-4 w-4" /> Add Skill</Button>
                  </form>
                </Form>
                <div className="mt-6 space-y-2">
                  <h4 className="font-medium">Your Skills</h4>
                  {appState.skills.length === 0 ? (<p className="text-sm text-muted-foreground">No skills added yet.</p>) : (
                    <ul className="space-y-2">
                      {appState.skills.map(skill => (
                        <li key={skill.id} className="flex items-center justify-between p-2 rounded-md bg-secondary">
                          <div className="flex flex-col">
                            <span className="font-semibold">{skill.name}</span>
                            <span className="text-sm text-muted-foreground">{skill.priority} Priority &middot; {skill.estHours} hrs</span>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => removeSkill(skill.id)}><Trash2 className="h-4 w-4" /></Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
            
            <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Popular Skills</CardTitle>
                      <CardDescription>Quickly add skills to your schedule.</CardDescription>
                    </div>
                    <Switch
                      checked={showPopularSkills}
                      onCheckedChange={setShowPopularSkills}
                      aria-label="Toggle popular skills"
                    />
                  </div>
                </CardHeader>
                {showPopularSkills && (
                  <CardContent>
                    <ul className="space-y-2">
                        {defaultSkills.map(skill => {
                          const isAdded = appState.skills.some(s => s.name.toLowerCase() === skill.name.toLowerCase());
                          return (
                            <li key={skill.name} className="flex items-center justify-between p-2 rounded-md bg-secondary/50">
                              <div>
                                <span className="font-semibold">{skill.name}</span>
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <Badge variant={
                                    skill.priority === 'High' ? 'destructive' 
                                    : skill.priority === 'Medium' ? 'secondary' 
                                    : 'outline'
                                  } className="text-xs">{skill.priority}</Badge>
                                  <span>{skill.estHours} hrs</span>
                                </div>
                              </div>
                              <Button variant="outline" size="sm" onClick={() => addSkill(skill)} disabled={isAdded}>
                                {isAdded ? 'Added' : <><Plus className="mr-2 h-4 w-4" /> Add</>}
                              </Button>
                            </li>
                          )
                        })}
                      </ul>
                  </CardContent>
                )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>2. Configure Your Schedule</CardTitle>
                <CardDescription>Set your availability and how you prefer to work.</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...settingsForm}>
                  <form onSubmit={settingsForm.handleSubmit(handleGenerate)} className="space-y-6">
                    <FormField name="mode" control={settingsForm.control} render={({ field }) => (
                      <FormItem>
                        <FormLabel>Plan Scope</FormLabel>
                        <FormControl>
                          <Tabs defaultValue={field.value} onValueChange={field.onChange} className="w-full">
                            <TabsList className="grid w-full grid-cols-2">
                              <TabsTrigger value="Daily">Daily</TabsTrigger>
                              <TabsTrigger value="Monthly">Monthly</TabsTrigger>
                            </TabsList>
                          </Tabs>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    
                    {watchMode === 'Daily' && (
                       <FormField name="dailyHours" control={settingsForm.control} render={({ field }) => (
                        <FormItem><FormLabel>Total Study Hours Per Day</FormLabel><FormControl><Input type="number" placeholder="e.g., 4" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                    )}

                    {watchMode === 'Monthly' && (
                      <div className="grid grid-cols-2 gap-4">
                        <FormField name="startDate" control={settingsForm.control} render={({ field }) => (
                          <FormItem><FormLabel>Start Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField name="endDate" control={settingsForm.control} render={({ field }) => (
                          <FormItem><FormLabel>End Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                    )}
                    
                    <div>
                      <FormLabel>Working Window</FormLabel>
                      <div className="grid grid-cols-2 gap-4 mt-2">
                        <FormField name="startTime" control={settingsForm.control} render={({ field }) => (
                          <FormItem><FormLabel className="text-xs text-muted-foreground">From</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField name="endTime" control={settingsForm.control} render={({ field }) => (
                          <FormItem><FormLabel className="text-xs text-muted-foreground">To</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                    </div>
                    
                    <div>
                      <FormLabel>Break Pattern</FormLabel>
                       <div className="grid grid-cols-2 gap-4 mt-2">
                        <FormField name="workBlockMins" control={settingsForm.control} render={({ field }) => (
                          <FormItem><FormLabel className="text-xs text-muted-foreground">Work (mins)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField name="breakMins" control={settingsForm.control} render={({ field }) => (
                          <FormItem><FormLabel className="text-xs text-muted-foreground">Break (mins)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                    </div>

                    <FormField name="lunchEnabled" control={settingsForm.control} render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Include Lunch Break?</FormLabel>
                        </div>
                        <FormControl>
                           <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                        </FormControl>
                      </FormItem>
                    )} />
                    
                    {watchLunchEnabled && (
                       <div className="grid grid-cols-2 gap-4">
                        <FormField name="lunchStart" control={settingsForm.control} render={({ field }) => (
                          <FormItem><FormLabel>Lunch Start</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField name="lunchDuration" control={settingsForm.control} render={({ field }) => (
                          <FormItem><FormLabel>Duration (mins)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                    )}

                    <Button type="submit" size="lg" className="w-full sticky bottom-8">Generate Schedule</Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>

          <div className="md:col-span-2 print-p-0">
             <Card className="print-card">
              <CardHeader className="no-print">
                <div className="flex flex-wrap justify-between items-center gap-4">
                    <div>
                        <CardTitle>3. Your Generated Schedule</CardTitle>
                        <CardDescription>Here is your optimized learning plan. You can now save, copy, or print it.</CardDescription>
                    </div>
                     <div className="flex flex-wrap gap-2">
                        <Button onClick={handleReset} variant="outline"><RotateCcw className="mr-2 h-4 w-4" /> Reset</Button>
                        <Button onClick={handleCopyJson} variant="outline"><Copy className="mr-2 h-4 w-4" /> Copy JSON</Button>
                        <Button onClick={handlePrint} variant="outline"><Download className="mr-2 h-4 w-4" /> Download as PDF</Button>
                    </div>
                </div>
              </CardHeader>
              <CardContent className="print-p-0">
                {!appState.schedule ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <p>Your schedule will appear here once generated.</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {appState.summary && (
                       <div className="p-6">
                        <h3 className="font-bold text-lg mb-4">Schedule Summary</h3>
                         <div className="hidden md:block">
                           <Table>
                            <TableHeader>
                              <TableRow><TableHead>Skill</TableHead><TableHead className="text-right">Total Time</TableHead><TableHead className="text-right">Allocation</TableHead></TableRow>
                            </TableHeader>
                            <TableBody>
                              {appState.summary.map(item => (
                                <TableRow key={item.skillId}>
                                  <TableCell>{item.skillName}</TableCell>
                                  <TableCell className="text-right">{`${Math.floor(item.minutes / 60)}h ${item.minutes % 60}m`}</TableCell>
                                  <TableCell className="text-right">{item.percent.toFixed(1)}%</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                         </div>
                         <div className="md:hidden space-y-4">
                            {appState.summary.map(item => (
                                <div key={item.skillId} className="p-4 rounded-lg border bg-card text-card-foreground shadow-sm">
                                    <div className="font-semibold text-lg">{item.skillName}</div>
                                    <div className="flex justify-between items-center mt-2 text-muted-foreground">
                                        <span>Total Time:</span>
                                        <span className="font-medium text-foreground">{`${Math.floor(item.minutes / 60)}h ${item.minutes % 60}m`}</span>
                                    </div>
                                    <div className="flex justify-between items-center mt-1 text-muted-foreground">
                                        <span>Allocation:</span>
                                        <span className="font-medium text-foreground">{item.percent.toFixed(1)}%</span>
                                    </div>
                                </div>
                            ))}
                         </div>
                      </div>
                    )}
                    
                    <div className="p-6 pt-0">
                       <h3 className="font-bold text-lg mb-2 pt-6">Daily Timetable</h3>
                       <Tabs defaultValue={defaultTab} className="w-full">
                        <TabsList className="no-print">
                          {appState.schedule.map(day => <TabsTrigger key={day.date} value={day.date}>{format(parse(day.date, 'yyyy-MM-dd', new Date()), 'EEE, MMM d')}</TabsTrigger>)}
                        </TabsList>
                        {appState.schedule.map(day => {
                          const isToday = day.date === appState.live?.date;
                          const progress = isToday ? getProgress() : (day.date < (appState.live?.date || '') ? 100 : 0);

                          return (
                          <TabsContent key={day.date} value={day.date} className="print-bg-transparent">
                             <div className="print-card mt-4">
                                <h4 className="font-semibold text-center mb-4 hidden print:block">{format(parse(day.date, 'yyyy-MM-dd', new Date()), 'EEEE, MMMM d, yyyy')}</h4>
                                {isToday && <div className="w-full h-1 my-2 bg-muted rounded-full no-print">
                                  <div className="h-full bg-primary rounded-full" style={{width: `${progress}%`}}></div>
                                </div>}
                                
                                {/* Desktop View */}
                                <Table className="hidden md:table">
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[120px]">Time</TableHead>
                                            <TableHead>Activity</TableHead>
                                            <TableHead className="text-right w-[100px]">Duration</TableHead>
                                            <TableHead className="text-center w-[120px] no-print">Status</TableHead>
                                            <TableHead className="w-[80px] no-print">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {day.blocks.map((block) => {
                                            const status = getTaskStatus(block, day);
                                            return (
                                            <TableRow 
                                              key={block.id} 
                                              className={cn(
                                                block.completed && 'bg-green-100/50 dark:bg-green-900/20',
                                                status.text === 'In Progress' && 'bg-blue-100/40 dark:bg-blue-900/20'
                                              )}
                                            >
                                                <TableCell className="font-mono">{block.start} - {block.end}</TableCell>
                                                <TableCell>
                                                  <div className="flex items-center gap-2">
                                                    {getIconForBlock(block.type)}
                                                    <span>{block.skillName || (block.type.charAt(0).toUpperCase() + block.type.slice(1))}</span>
                                                  </div>
                                                </TableCell>
                                                <TableCell className="text-right text-muted-foreground">{block.minutes} min</TableCell>
                                                <TableCell className={cn("text-center font-medium no-print", status.color)}>
                                                    {status.text}
                                                </TableCell>
                                                <TableCell className="no-print">
                                                  {block.type === 'work' && (
                                                    <div className="flex items-center justify-center">
                                                      <Checkbox
                                                        id={`task-${block.id}`}
                                                        checked={!!block.completed}
                                                        onCheckedChange={() => toggleTaskCompletion(day.date, block.id)}
                                                        aria-label={`Mark ${block.skillName} as complete`}
                                                      />
                                                    </div>
                                                  )}
                                                </TableCell>
                                            </TableRow>
                                        )})}
                                    </TableBody>
                                </Table>

                                {/* Mobile View */}
                                <div className="md:hidden space-y-4">
                                  {day.blocks.map(block => {
                                      const status = getTaskStatus(block, day);
                                      return (
                                        <div key={block.id} className={cn(
                                          "p-4 rounded-lg border shadow-sm",
                                          block.completed ? 'bg-green-100/50 dark:bg-green-900/20' : 'bg-card',
                                          status.text === 'In Progress' && 'bg-blue-100/40 dark:bg-blue-900/20'
                                        )}>
                                          <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-3">
                                              {getIconForBlock(block.type)}
                                              <div>
                                                <div className="font-semibold">{block.skillName || (block.type.charAt(0).toUpperCase() + block.type.slice(1))}</div>
                                                <div className="text-sm text-muted-foreground font-mono">{block.start} - {block.end} ({block.minutes} min)</div>
                                              </div>
                                            </div>
                                            {block.type === 'work' && (
                                              <Checkbox
                                                  id={`task-mobile-${block.id}`}
                                                  checked={!!block.completed}
                                                  onCheckedChange={() => toggleTaskCompletion(day.date, block.id)}
                                                  aria-label={`Mark ${block.skillName} as complete`}
                                                />
                                            )}
                                          </div>
                                          {block.type === 'work' && (
                                            <div className="mt-3 text-sm">
                                              <span className="text-muted-foreground">Status: </span>
                                              <span className={cn("font-medium", status.color)}>{status.text}</span>
                                            </div>
                                          )}
                                        </div>
                                      )
                                  })}
                                </div>
                             </div>
                          </TabsContent>
                        )})}
                      </Tabs>
                    </div>

                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <footer className="container py-6 text-center text-sm text-muted-foreground no-print">
        <p>Developed by GUHAN S</p>
      </footer>
    </div>
  )
}
